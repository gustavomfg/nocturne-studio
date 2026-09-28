// Operation-scoped rollback worker. No shell, generic filesystem API or replay.
#include <iostream>
#include <string>
#include <sstream>
#include <vector>
#include <stdexcept>
#include <cstdint>

#if defined(__linux__)
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/syscall.h>
#include <linux/openat2.h>
#include <linux/magic.h>
#include <cerrno>

static constexpr size_t MAX_BYTES = 32 * 1024 * 1024;
struct Failure : std::runtime_error {
  std::string code;
  Failure(std::string c, const char* m): std::runtime_error(m), code(std::move(c)) {}
};
static void require(bool value, const char* message) {
  if (!value) throw Failure("CONFLICT", message);
}
static int checked(int fd) {
  if (fd >= 0) return fd;
  const int e = errno;
  if (e == ENOSYS || e == EOPNOTSUPP || e == EXDEV || e == EINVAL)
    throw Failure("UNSUPPORTED", "Required native primitive unavailable");
  throw Failure("CONFLICT", "Filesystem operation refused");
}
struct FD {
  int value = -1;
  FD() = default;
  explicit FD(int fd): value(checked(fd)) {}
  FD(const FD&) = delete;
  FD& operator=(const FD&) = delete;
  ~FD() { if (value >= 0) ::close(value); }
  void reset(int fd = -1) { if (value >= 0) ::close(value); value = fd; }
};
static std::string unhex(const std::string& s) {
  require(s.size() % 2 == 0 && s.size() <= MAX_BYTES * 2, "Invalid frame");
  std::string result;
  result.reserve(s.size() / 2);
  auto digit = [](char c) -> int {
    if (c >= '0' && c <= '9') return c-'0';
    if (c >= 'a' && c <= 'f') return c-'a'+10;
    throw Failure("CONFLICT", "Invalid hex encoding");
  };
  for (size_t i=0;i<s.size();i+=2) result.push_back(static_cast<char>(digit(s[i])*16+digit(s[i+1])));
  return result;
}
static std::string hex(const std::string& s) {
  static const char digits[]="0123456789abcdef";
  std::string result;
  result.reserve(s.size()*2);
  for (unsigned char c:s) { result.push_back(digits[c>>4]); result.push_back(digits[c&15]); }
  return result;
}
static struct stat metadata(int fd) {
  struct stat s{}; require(fstat(fd,&s)==0,"Identity unavailable"); return s;
}
static std::string identity(int fd) {
  const auto s=metadata(fd);
  return std::to_string(static_cast<uint64_t>(s.st_dev))+":"+std::to_string(static_cast<uint64_t>(s.st_ino));
}
static int constrained(int parent,const std::string& name,bool directory,bool crossing=false) {
  open_how how{};
  how.flags=O_RDONLY|O_CLOEXEC|O_NOFOLLOW|(directory?O_DIRECTORY:O_NONBLOCK);
  how.resolve=RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS|(crossing?0:RESOLVE_NO_XDEV);
  return static_cast<int>(syscall(SYS_openat2,parent,name.c_str(),&how,sizeof(how)));
}
static int acquireRoot(const std::string& path) {
  require(path.size()>1 && path[0]=='/' && path.find('\0')==std::string::npos,"Invalid root");
  FD slash(open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC));
  return checked(constrained(slash.value,path.substr(1),true,true));
}
static std::string readBytes(int fd) {
  require(S_ISREG(metadata(fd).st_mode),"Only regular files are supported");
  std::string data; char buf[16384]; off_t offset=0;
  for (;;) {
    ssize_t n=pread(fd,buf,sizeof(buf),offset);
    if(n<0 && errno==EINTR) continue;
    require(n>=0,"Read failed");
    if(!n) break;
    require(data.size()+static_cast<size_t>(n)<=MAX_BYTES,"File exceeds rollback budget");
    data.append(buf,static_cast<size_t>(n));offset+=n;
  }
  return data;
}
static void writeAll(int fd,const std::string& bytes) {
  size_t offset=0;
  while(offset<bytes.size()) {
    ssize_t n=write(fd,bytes.data()+offset,bytes.size()-offset);
    if(n<0 && errno==EINTR) continue;
    require(n>0,"Write failed");offset+=static_cast<size_t>(n);
  }
}
static void flush(int fd) { if(fsync(fd)!=0) throw Failure("UNKNOWN","Durability acknowledgment unavailable"); }
static void validRelative(const std::string& value) {
  require(!value.empty() && value.size()<4096 && value[0]!='/' && value.find('\0')==std::string::npos
    && value.find('\\')==std::string::npos,"Invalid relative path");
  std::istringstream stream(value);std::string part;
  while(std::getline(stream,part,'/')) {
    require(!part.empty() && part!="." && part!=".." && part!=".git" && part!=".nocturne"
      && part.rfind(".nocturne-rollback-",0)!=0,"Protected path");
  }
}

class Operation {
  FD root, recovery, parent, observed, staged, displaced, log, snapshot;
  std::string rootPath,rootId,recoveryPath,recoveryId,parentPath,parentId,leaf,observedId,observedBytes,stagedBytes,displacedName;
  mode_t observedMode=0,stagedMode=0;
  bool active=false,opened=false,prepared=false,moved=false,published=false;
  void admit() {
    if(!active) throw Failure("REVOKED","Operation no longer active");
    try {
      FD currentRoot(acquireRoot(rootPath));
      FD currentRecovery(acquireRoot(recoveryPath));
      require(identity(currentRoot.value)==rootId && identity(currentRecovery.value)==recoveryId,"Root binding lost");
      if(opened) {
        FD currentParent(constrained(root.value,parentPath,true));
        require(identity(currentParent.value)==parentId,"Parent binding lost");
      }
    } catch(...) { active=false;throw Failure("REVOKED","Required structural binding lost"); }
  }
  int openLeaf(const std::string& name) { return constrained(parent.value,name,false); }
  void verifyObserved() {
    FD current;
    int fd=openLeaf(leaf);
    if(observed.value<0) { require(fd<0 && errno==ENOENT,"Destination appeared");return; }
    current.reset(checked(fd));
    require(identity(current.value)==observedId && metadata(current.value).st_mode==observedMode
      && readBytes(current.value)==observedBytes,"Observed AFTER changed");
  }
public:
  void revoke() { active=false; }
  std::string execute(const std::vector<std::string>& args) {
    const auto& cmd=args.at(0);
    if(cmd=="INIT") {
      require(args.size()==5 && root.value<0,"Invalid initialization");
      rootPath=unhex(args[1]);rootId=unhex(args[2]);recoveryPath=unhex(args[3]);recoveryId=unhex(args[4]);
      root.reset(acquireRoot(rootPath));recovery.reset(acquireRoot(recoveryPath));
      require(identity(root.value)==rootId && identity(recovery.value)==recoveryId,"Root identity changed");
      struct statfs filesystem{};
      require(fstatfs(root.value,&filesystem)==0,"Filesystem unavailable");
      if(filesystem.f_type!=TMPFS_MAGIC && filesystem.f_type!=EXT4_SUPER_MAGIC)
        throw Failure("UNSUPPORTED","V1 requires local tmpfs or ext4");
      log.reset(checked(openat(recovery.value,"steps.jsonl",O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0600)));
      snapshot.reset(checked(openat(recovery.value,"operation.json",O_RDWR|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0600)));
      flush(recovery.value);active=true;return "OK";
    }
    if(cmd=="JOURNAL") {
      require(args.size()==3 && log.value>=0,"Journal unavailable");
      const auto data=unhex(args[1]),entry=unhex(args[2]);
      require(data.size()<=1024*1024 && entry.size()<=65536,"Journal budget exceeded");
      writeAll(log.value,entry+"\n");flush(log.value);
      require(lseek(snapshot.value,0,SEEK_SET)==0 && ftruncate(snapshot.value,0)==0,"Journal snapshot unavailable");
      writeAll(snapshot.value,data);flush(snapshot.value);return "OK";
    }
    if(cmd=="REVOKE") { revoke();return "OK"; }
    admit();
    if(cmd=="NEXT") {
      require(published,"Previous file not verified");
      observed.reset();staged.reset();displaced.reset();parent.reset();
      opened=false;prepared=false;moved=false;published=false;
      observedBytes.clear();observedId.clear();stagedBytes.clear();return "OK";
    }
    if(cmd=="OPEN") {
      require(args.size()==2 && !opened,"File already acquired");
      const auto relative=unhex(args[1]);validRelative(relative);
      const auto slash=relative.rfind('/');
      parentPath=slash==std::string::npos?".":relative.substr(0,slash);
      leaf=slash==std::string::npos?relative:relative.substr(slash+1);
      parent.reset(checked(constrained(root.value,parentPath,true)));parentId=identity(parent.value);opened=true;
      int fd=openLeaf(leaf);
      if(fd<0 && errno==ENOENT) return "DATA\t0\t0\t\t\t"+hex(parentId);
      observed.reset(checked(fd));observedId=identity(observed.value);observedMode=metadata(observed.value).st_mode;
      observedBytes=readBytes(observed.value);
      return "DATA\t1\t"+std::to_string(observedMode)+"\t"+hex(observedId)+"\t"+hex(observedBytes)+"\t"+hex(parentId);
    }
    if(cmd=="STAGE") {
      require(args.size()==3 && opened && !prepared,"Invalid staging state");
      stagedBytes=unhex(args[1]);stagedMode=static_cast<mode_t>(std::stoul(args[2]));
      require((stagedMode & 07000)==0,"Special permission bits unsupported");
      // No basename ever identifies this source. Missing primitive fails closed.
      staged.reset(checked(openat(parent.value,".",O_TMPFILE|O_RDWR|O_CLOEXEC,0600)));
      writeAll(staged.value,stagedBytes);
      require(fchmod(staged.value,stagedMode & 0777)==0,"Stage mode failed");flush(staged.value);
      require(readBytes(staged.value)==stagedBytes,"Staged bytes changed");prepared=true;
      return "STAGED\t"+hex(identity(staged.value));
    }
    if(cmd=="DISPLACE") {
      require(args.size()==2 && opened && !moved && !published,"Invalid displacement state");
      verifyObserved();displacedName=unhex(args[1]);
      require(displacedName.rfind(".nocturne-rollback-",0)==0 && displacedName.find('/')==std::string::npos
        && displacedName.find('\0')==std::string::npos,"Invalid retention entry");
      if(observed.value<0) return "OK";
      // No source-inode CAS is claimed. Preserve the actual entry selected by rename.
      checked(static_cast<int>(syscall(SYS_renameat2,parent.value,leaf.c_str(),parent.value,displacedName.c_str(),1)));
      moved=true;flush(parent.value);
      displaced.reset(checked(openLeaf(displacedName)));
      require(identity(displaced.value)==observedId && metadata(displaced.value).st_mode==observedMode
        && readBytes(displaced.value)==observedBytes,"Competing displaced object preserved; conflict");
      return "DISPLACED\t"+hex(identity(displaced.value));
    }
    if(cmd=="PUBLISH") {
      require(args.size()==1 && opened && !published && (observed.value<0 || moved),"Invalid publication state");
      if(prepared) {
        require(readBytes(staged.value)==stagedBytes,"Staged bytes changed");
        const auto source="/proc/self/fd/"+std::to_string(staged.value);
        // This retained proc/self FD reference selects the anonymous source;
        // never fall back to a temporary filename or AT_EMPTY_PATH privilege.
        checked(linkat(AT_FDCWD,source.c_str(),parent.value,leaf.c_str(),AT_SYMLINK_FOLLOW));published=true;
        flush(parent.value);
        FD produced(checked(openLeaf(leaf)));
        require(identity(produced.value)==identity(staged.value) && readBytes(produced.value)==stagedBytes
          && (metadata(produced.value).st_mode & 0777)==(stagedMode & 0777),"Produced state diverged");
      } else {
        int fd=openLeaf(leaf);if(fd>=0) { FD unexpected(fd);throw Failure("CONFLICT","Deleted entry recreated"); }
        require(errno==ENOENT,"Absence unavailable");published=true;
      }
      if(moved) require(identity(displaced.value)==observedId && readBytes(displaced.value)==observedBytes,"Displaced bytes changed");
      admit();return "OK";
    }
    throw Failure("CONFLICT","Unknown operation");
  }
};
int main() {
  Operation operation;std::string line;
  while(std::getline(std::cin,line)) {
    try {
      require(line.size()<=MAX_BYTES*2+16384,"Frame budget exceeded");
      std::vector<std::string> args;std::istringstream frame(line);std::string part;
      while(std::getline(frame,part,'\t')) args.push_back(part);
      if(line=="CLOSE") break;
      std::cout<<operation.execute(args)<<'\n'<<std::flush;
    } catch(const Failure& error) {
      operation.revoke();std::cout<<"ERR\t"<<error.code<<"\t"<<hex(error.what())<<'\n'<<std::flush;
    } catch(...) {
      operation.revoke();std::cout<<"ERR\tUNKNOWN\t"<<hex("Native protocol interrupted")<<'\n'<<std::flush;
    }
  }
}
#else
// Deliberate V1 fail-closed backend. No pathname fallback on Darwin/Windows.
int main() {
  std::string line;
  while(std::getline(std::cin,line)) {
    if(line=="CLOSE") break;
    std::cout<<"ERR\tUNSUPPORTED\t50726f74656374656420726f6c6c6261636b206261636b656e64206e6f74207665726966696564\n"<<std::flush;
  }
}
#endif
