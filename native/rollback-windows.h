// Windows backend for the existing worker protocol. Main process only.
// NT relative opens/renames are necessary: ordinary Win32 path resolution and
// a metadata/share handle are NOT continuous namespace pinning.
#define NOMINMAX
#include <windows.h>
#include <winternl.h>
#include <cstddef>
#include <cwctype>
#include <algorithm>
#include <cstring>

static constexpr size_t MAX_BYTES = 32 * 1024 * 1024;
struct Failure : std::runtime_error {
  std::string code;
  Failure(std::string c, const char* m): std::runtime_error(m), code(std::move(c)) {}
};
static void require(bool value, const char* message) { if(!value) throw Failure("CONFLICT",message); }
struct Handle {
  HANDLE value=INVALID_HANDLE_VALUE;
  Handle()=default;
  explicit Handle(HANDLE h):value(h) {}
  Handle(const Handle&)=delete;
  Handle& operator=(const Handle&)=delete;
  ~Handle(){ if(value!=INVALID_HANDLE_VALUE) CloseHandle(value); }
  void reset(HANDLE h=INVALID_HANDLE_VALUE){ if(value!=INVALID_HANDLE_VALUE) CloseHandle(value);value=h; }
};
static std::string unhex(const std::string& s) {
  require(s.size()%2==0 && s.size()<=MAX_BYTES*2,"Invalid frame");
  std::string r;r.reserve(s.size()/2);
  auto digit=[](char c)->int {if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;throw Failure("CONFLICT","Invalid hex");};
  for(size_t i=0;i<s.size();i+=2)r.push_back(static_cast<char>(digit(s[i])*16+digit(s[i+1])));
  return r;
}
static std::string hex(const std::string& s) {
  static const char d[]="0123456789abcdef";std::string r;r.reserve(s.size()*2);
  for(unsigned char c:s){r.push_back(d[c>>4]);r.push_back(d[c&15]);}return r;
}
static std::wstring wide(const std::string& s) {
  require(!s.empty()&&s.size()<32768&&s.find('\0')==std::string::npos,"Invalid name");
  int n=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,s.data(),static_cast<int>(s.size()),nullptr,0);
  require(n>0,"Invalid UTF8");std::wstring r(static_cast<size_t>(n),L'\0');
  require(MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,s.data(),static_cast<int>(s.size()),r.data(),n)==n,"Invalid UTF8");return r;
}
static void validEntry(const std::string& s,bool internal=false) {
  require(!s.empty()&&s.size()<256&&s!="."&&s!=".."&&s.find_first_of("/\\:\0",0,4)==std::string::npos
    &&s.back()!='.'&&s.back()!=' ',"Invalid single entry");
  auto w=wide(s);for(auto& c:w)c=static_cast<wchar_t>(towupper(c));
  const auto dot=w.find(L'.');const auto base=w.substr(0,dot);
  require(base!=L"CON"&&base!=L"PRN"&&base!=L"AUX"&&base!=L"NUL"
    &&!(base.size()==4&&(base.substr(0,3)==L"COM"||base.substr(0,3)==L"LPT")&&base[3]>=L'0'&&base[3]<=L'9'),"Device name unsupported");
  if(!internal)require(w!=L".GIT"&&w!=L".NOCTURNE"&&w.rfind(L".NOCTURNE-ROLLBACK-",0)!=0,"Protected entry");
}
static BY_HANDLE_FILE_INFORMATION metadata(HANDLE h) {
  BY_HANDLE_FILE_INFORMATION i{};require(GetFileInformationByHandle(h,&i)!=0,"Identity unavailable");return i;
}
static std::string identity(HANDLE h) {
  const auto i=metadata(h);return std::to_string(i.dwVolumeSerialNumber)+":"+std::to_string(i.nFileIndexHigh)+":"+std::to_string(i.nFileIndexLow);
}
static unsigned mode(HANDLE h) { return 0100000u|((metadata(h).dwFileAttributes&FILE_ATTRIBUTE_READONLY)?0444u:0666u); }
using NtOpen=NTSTATUS(NTAPI*)(PHANDLE,ACCESS_MASK,POBJECT_ATTRIBUTES,PIO_STATUS_BLOCK,PLARGE_INTEGER,ULONG,ULONG,ULONG,ULONG,PVOID,ULONG);
using NtSet=NTSTATUS(NTAPI*)(HANDLE,PIO_STATUS_BLOCK,PVOID,ULONG,FILE_INFORMATION_CLASS);
using NtError=ULONG(WINAPI*)(NTSTATUS);
static HANDLE relativeOpen(HANDLE parent,const std::string& name,bool directory,bool create=false,bool writable=false,bool renameable=false) {
  validEntry(name,true);auto w=wide(name);
  UNICODE_STRING u{};u.Buffer=w.data();u.Length=static_cast<USHORT>(w.size()*sizeof(wchar_t));u.MaximumLength=u.Length;
  OBJECT_ATTRIBUTES a{};a.Length=sizeof(a);a.RootDirectory=parent;a.ObjectName=&u;a.Attributes=0x40; // case-insensitive
  auto fn=reinterpret_cast<NtOpen>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtCreateFile"));
  auto error=reinterpret_cast<NtError>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"RtlNtStatusToDosError"));
  if(!fn||!error)throw Failure("UNSUPPORTED","Required NT relative acquisition unavailable");
  HANDLE h=INVALID_HANDLE_VALUE;IO_STATUS_BLOCK io{};
  ACCESS_MASK access=directory?(FILE_LIST_DIRECTORY|FILE_TRAVERSE|FILE_READ_ATTRIBUTES|SYNCHRONIZE):(GENERIC_READ|SYNCHRONIZE);
  if(writable)access|=GENERIC_WRITE;if(renameable)access|=DELETE;
  // FILE_SYNCHRONOUS_IO_NONALERT, FILE_OPEN_REPARSE_POINT, directory/non-directory.
  NTSTATUS s=fn(&h,access,&a,&io,nullptr,FILE_ATTRIBUTE_NORMAL,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,
    create?2u:1u,0x20u|0x200000u|(directory?1u:0x40u),nullptr,0);
  if(s<0){SetLastError(error(s));return INVALID_HANDLE_VALUE;}
  FILE_ATTRIBUTE_TAG_INFO tag{};
  if(!GetFileInformationByHandleEx(h,FileAttributeTagInfo,&tag,sizeof(tag))||(tag.FileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)){
    CloseHandle(h);SetLastError(ERROR_CANT_ACCESS_FILE);return INVALID_HANDLE_VALUE;
  }
  return h;
}
static HANDLE checked(HANDLE h) {
  if(h!=INVALID_HANDLE_VALUE)return h;
  const auto e=GetLastError();
  if(e==ERROR_NOT_SUPPORTED||e==ERROR_INVALID_FUNCTION||e==ERROR_NOT_SAME_DEVICE)throw Failure("UNSUPPORTED","Required native primitive unavailable");
  throw Failure("CONFLICT","Windows filesystem operation refused");
}
static HANDLE duplicate(HANDLE h) {
  HANDLE r=INVALID_HANDLE_VALUE;require(DuplicateHandle(GetCurrentProcess(),h,GetCurrentProcess(),&r,0,FALSE,DUPLICATE_SAME_ACCESS)!=0,"Capability duplication failed");return r;
}
static HANDLE walk(HANDLE root,const std::string& path) {
  Handle current(duplicate(root));if(path==".")return duplicate(current.value);
  std::istringstream parts(path);std::string part;
  while(std::getline(parts,part,'/')) {
    validEntry(part);Handle next(checked(relativeOpen(current.value,part,true)));
    require(metadata(next.value).dwVolumeSerialNumber==metadata(root).dwVolumeSerialNumber,"Volume crossing unsupported");
    current.reset(duplicate(next.value));
  }
  return duplicate(current.value);
}
static HANDLE acquireRoot(std::string path) {
  std::replace(path.begin(),path.end(),'\\','/');
  require(path.size()>3&&path[1]==':'&&path[2]=='/'&&((path[0]>='A'&&path[0]<='Z')||(path[0]>='a'&&path[0]<='z')),"Only local drive roots supported");
  auto drive=wide(path.substr(0,3));drive[2]=L'\\';
  if(GetDriveTypeW(drive.c_str())!=DRIVE_FIXED)throw Failure("UNSUPPORTED","V1 requires a fixed local NTFS volume");
  auto anchor=L"\\\\?\\"+drive;
  Handle root(checked(CreateFileW(anchor.c_str(),FILE_LIST_DIRECTORY|FILE_TRAVERSE|FILE_READ_ATTRIBUTES|SYNCHRONIZE,
    FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,nullptr)));
  wchar_t filesystem[32]{};
  if(!GetVolumeInformationByHandleW(root.value,nullptr,0,nullptr,nullptr,nullptr,filesystem,32)||std::wstring(filesystem)!=L"NTFS")
    throw Failure("UNSUPPORTED","V1 requires NTFS");
  return walk(root.value,path.substr(3));
}
static std::string readBytes(HANDLE h) {
  auto i=metadata(h);require(!(i.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))&&GetFileType(h)==FILE_TYPE_DISK,"Only regular files supported");
  LARGE_INTEGER size{},zero{};require(GetFileSizeEx(h,&size)&&size.QuadPart>=0&&size.QuadPart<=static_cast<LONGLONG>(MAX_BYTES),"File exceeds rollback budget");
  require(SetFilePointerEx(h,zero,nullptr,FILE_BEGIN)!=0,"Read seek failed");std::string r;char buffer[16384];DWORD n=0;
  for(;;){require(ReadFile(h,buffer,sizeof(buffer),&n,nullptr)!=0,"Read failed");if(!n)break;require(r.size()+n<=MAX_BYTES,"File exceeds rollback budget");r.append(buffer,n);}return r;
}
static void writeAll(HANDLE h,const std::string& s) {
  size_t offset=0;while(offset<s.size()){DWORD n=0;require(WriteFile(h,s.data()+offset,static_cast<DWORD>(s.size()-offset),&n,nullptr)&&n>0,"Write failed");offset+=n;}
}
static void flush(HANDLE h){if(!FlushFileBuffers(h))throw Failure("UNKNOWN","Durability acknowledgment unavailable");}
static void renameExclusive(HANDLE source,HANDLE parent,const std::string& name) {
  validEntry(name,true);auto w=wide(name);std::vector<unsigned char> buffer(offsetof(FILE_RENAME_INFO,FileName)+(w.size()+1)*sizeof(wchar_t));
  auto info=reinterpret_cast<FILE_RENAME_INFO*>(buffer.data());info->ReplaceIfExists=FALSE;info->RootDirectory=parent;
  info->FileNameLength=static_cast<DWORD>(w.size()*sizeof(wchar_t));memcpy(info->FileName,w.data(),info->FileNameLength);
  auto fn=reinterpret_cast<NtSet>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtSetInformationFile"));
  if(!fn)throw Failure("UNSUPPORTED","Handle-relative rename unavailable");
  IO_STATUS_BLOCK io{};const auto status=fn(source,&io,buffer.data(),static_cast<ULONG>(buffer.size()),static_cast<FILE_INFORMATION_CLASS>(10));
  if(status<0)throw Failure("CONFLICT","Exclusive handle-relative rename refused");
}

class Operation {
  Handle root,recovery,parent,observed,staged,log,snapshot;
  std::string rootPath,rootId,recoveryPath,recoveryId,parentPath,parentId,leaf,observedId,observedBytes,stagedBytes,displacedName;
  unsigned observedMode=0;
  bool active=false,opened=false,prepared=false,moved=false,published=false;
  void admit(){
    if(!active)throw Failure("REVOKED","Operation no longer active");
    try {
      Handle r(acquireRoot(rootPath)),j(acquireRoot(recoveryPath));
      require(identity(r.value)==rootId&&identity(j.value)==recoveryId,"Root binding lost");
      if(opened){Handle p(walk(root.value,parentPath));require(identity(p.value)==parentId,"Parent binding lost");}
    }catch(...){active=false;throw Failure("REVOKED","Required structural binding lost");}
  }
  void verifyObserved(){
    Handle current(relativeOpen(parent.value,leaf,false));
    if(observed.value==INVALID_HANDLE_VALUE){require(current.value==INVALID_HANDLE_VALUE&&GetLastError()==ERROR_FILE_NOT_FOUND,"Destination appeared");return;}
    require(current.value!=INVALID_HANDLE_VALUE&&identity(current.value)==observedId&&mode(current.value)==observedMode&&readBytes(current.value)==observedBytes,"Observed AFTER changed");
  }
public:
  void revoke(){active=false;}
  std::string execute(const std::vector<std::string>& args){
    const auto& cmd=args.at(0);
    if(cmd=="BIND"){
      require(args.size()==2&&root.value==INVALID_HANDLE_VALUE,"Invalid custody request");root.reset(acquireRoot(unhex(args[1])));
      return "BOUND\t"+hex(identity(root.value));
    }
    if(cmd=="INIT"){
      require(args.size()==5&&root.value==INVALID_HANDLE_VALUE,"Invalid initialization");
      rootPath=unhex(args[1]);rootId=unhex(args[2]);recoveryPath=unhex(args[3]);recoveryId=unhex(args[4]);
      root.reset(acquireRoot(rootPath));recovery.reset(acquireRoot(recoveryPath));
      require(identity(root.value)==rootId&&identity(recovery.value)==recoveryId,"Root identity changed");
      log.reset(checked(relativeOpen(recovery.value,"steps.jsonl",false,true,true)));
      snapshot.reset(checked(relativeOpen(recovery.value,"operation.json",false,true,true)));active=true;return "OK";
    }
    if(cmd=="JOURNAL"){
      require(args.size()==3&&log.value!=INVALID_HANDLE_VALUE,"Journal unavailable");auto data=unhex(args[1]),entry=unhex(args[2]);
      require(data.size()<=1024*1024&&entry.size()<=65536,"Journal budget exceeded");writeAll(log.value,entry+"\n");flush(log.value);
      LARGE_INTEGER zero{};require(SetFilePointerEx(snapshot.value,zero,nullptr,FILE_BEGIN)&&SetEndOfFile(snapshot.value),"Snapshot truncate failed");
      writeAll(snapshot.value,data);flush(snapshot.value);return "OK";
    }
    if(cmd=="REVOKE"){revoke();return "OK";}admit();
    if(cmd=="NEXT"){
      require(published,"Previous file not verified");observed.reset();staged.reset();parent.reset();
      opened=false;prepared=false;moved=false;published=false;observedBytes.clear();observedId.clear();stagedBytes.clear();return "OK";
    }
    if(cmd=="OPEN"){
      require(args.size()==2&&!opened,"File already acquired");auto relative=unhex(args[1]);require(relative.size()<4096,"Path budget exceeded");
      std::istringstream parts(relative);std::string part;while(std::getline(parts,part,'/'))validEntry(part);
      const auto slash=relative.rfind('/');parentPath=slash==std::string::npos?".":relative.substr(0,slash);leaf=slash==std::string::npos?relative:relative.substr(slash+1);
      validEntry(leaf);parent.reset(walk(root.value,parentPath));parentId=identity(parent.value);opened=true;
      HANDLE h=relativeOpen(parent.value,leaf,false,false,false,true);
      if(h==INVALID_HANDLE_VALUE&&GetLastError()==ERROR_FILE_NOT_FOUND)return "DATA\t0\t0\t\t\t"+hex(parentId);
      observed.reset(checked(h));observedId=identity(observed.value);observedMode=mode(observed.value);observedBytes=readBytes(observed.value);
      return "DATA\t1\t"+std::to_string(observedMode)+"\t"+hex(observedId)+"\t"+hex(observedBytes)+"\t"+hex(parentId);
    }
    if(cmd=="STAGE"){
      require(args.size()==3&&opened&&!prepared,"Invalid stage state");stagedBytes=unhex(args[1]);auto requested=std::stoul(args[2]);
      if((requested&07000)!=0||(requested&0222)==0)throw Failure("UNSUPPORTED","V1 requires writable regular-file staging");
      // A name exists, but publication selects this HANDLE, never reopens it.
      // No delete-on-close or name-based cleanup; artifacts remain on conflict.
      static unsigned serial=0;const auto name=".nocturne-rollback-stage-"+std::to_string(GetCurrentProcessId())+"-"+std::to_string(++serial);
      staged.reset(checked(relativeOpen(parent.value,name,false,true,true,true)));writeAll(staged.value,stagedBytes);flush(staged.value);
      require(readBytes(staged.value)==stagedBytes,"Stage changed");prepared=true;return "STAGED\t"+hex(identity(staged.value));
    }
    if(cmd=="DISPLACE"){
      require(args.size()==2&&opened&&!moved&&!published,"Invalid displacement state");verifyObserved();displacedName=unhex(args[1]);
      validEntry(displacedName,true);require(displacedName.rfind(".nocturne-rollback-",0)==0,"Invalid retention entry");
      if(observed.value==INVALID_HANDLE_VALUE)return "OK";
      renameExclusive(observed.value,parent.value,displacedName);moved=true;
      Handle actual(checked(relativeOpen(parent.value,displacedName,false)));
      require(identity(actual.value)==observedId&&readBytes(actual.value)==observedBytes,"Displaced object diverged");
      return "DISPLACED\t"+hex(observedId);
    }
    if(cmd=="PUBLISH"){
      require(args.size()==1&&opened&&!published&&(observed.value==INVALID_HANDLE_VALUE||moved),"Invalid publication state");
      if(prepared){
        require(readBytes(staged.value)==stagedBytes,"Stage changed");renameExclusive(staged.value,parent.value,leaf);published=true;
        Handle produced(checked(relativeOpen(parent.value,leaf,false)));
        require(identity(produced.value)==identity(staged.value)&&readBytes(produced.value)==stagedBytes&&mode(produced.value)==0100666u,"Produced state diverged");
      }else{
        Handle unexpected(relativeOpen(parent.value,leaf,false));require(unexpected.value==INVALID_HANDLE_VALUE&&GetLastError()==ERROR_FILE_NOT_FOUND,"Deleted entry recreated");published=true;
      }
      if(moved)require(identity(observed.value)==observedId&&readBytes(observed.value)==observedBytes,"Displaced bytes changed");admit();return "OK";
    }
    throw Failure("CONFLICT","Unknown operation");
  }
};
int main(){
  Operation operation;std::string line;
  while(std::getline(std::cin,line)){
    try {
      require(line.size()<=MAX_BYTES*2+16384,"Frame budget exceeded");if(line=="CLOSE")break;
      std::vector<std::string> args;std::istringstream frame(line);std::string part;while(std::getline(frame,part,'\t'))args.push_back(part);
      std::cout<<operation.execute(args)<<'\n'<<std::flush;
    }catch(const Failure& e){operation.revoke();std::cout<<"ERR\t"<<e.code<<"\t"<<hex(e.what())<<'\n'<<std::flush;}
    catch(...){operation.revoke();std::cout<<"ERR\tUNKNOWN\t"<<hex("Native protocol interrupted")<<'\n'<<std::flush;}
  }
}
