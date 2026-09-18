# Backup, restauração e recuperação

[English](backup-and-recovery.md)

## Exportar e importar

Use **Configurações > Dados e diagnóstico > Exportar backup**. A exportação tem
envelope versionado, checksum SHA-256 e não inclui credenciais de Providers nem
arquivos do projeto.

Este é um **backup de conteúdo**, não uma recuperação operacional nem um
arquivo forense. Ele contém workspaces, conversas e mensagens, artefatos, o
espelho de memória do workspace no banco, memórias do Segundo Cérebro e seu
histórico, sugestões e suas decisões, além de configurações não secretas de
Providers/modelos/bindings e preferências. Ele não contém execuções, auditoria
de aprovações, validações, ChangeSets, checkpoints ou seus bytes privados de
rollback, comandos/erros/links de validação da execução, operações
interrompidas ou manifests de evidência. Project Index, Semantic Index e
Engineering Intelligence são derivados e também ficam fora deste contrato
portável.

Antes de alterar o banco, o Nocturne valida tamanho, estrutura, checksum,
compatibilidade de schema, identificadores duplicados e relacionamentos. Um
snapshot local é criado primeiro; a importação é transacional e rejeita payload
inválido. A restauração completa substitui os dados exportáveis. A parcial
substitui projetos, conversas, artefatos, sugestões e memórias, preservando
Providers, catálogo de modelos e preferências desta instalação.

Workspaces restaurados ficam deliberadamente desautorizados. Selecione a pasta
correspondente novamente antes de Git, memória ou IA acessarem o projeto.

A restauração não representa registros operacionais omitidos como restaurados
ou recuperáveis. Cascades de chaves estrangeiras removem os registros locais
ligados ao conteúdo substituído; dados operacionais locais não relacionados não
são mesclados ao backup como se tivessem sido exportados. O snapshot local
criado antes da restauração é o ponto de recuperação da instalação substituída.

## Recuperação do banco

A integridade SQLite é verificada na inicialização. Antes das migrações, o
aplicativo valida o banco, consolida o WAL, cria uma cópia pré-migração com
permissão restritiva e mantém os candidatos mais recentes. Um banco corrompido
é preservado em uma pasta de quarentena. Um candidato compatível e válido só é
restaurado depois da confirmação no diálogo nativo de recovery. Sem candidato
válido, a inicialização falha sem criar silenciosamente um banco vazio.

O engine valida candidatos antes de oferecê-los e preserva o banco original e
seus artefatos WAL/SHM quando possível. Artefato temporário ou falha de permissão
não é tratado como banco válido.

## O que manter separado

Backups não contêm arquivos-fonte, histórico Git ou o cofre de credenciais do
sistema operacional. Isso inclui `.nocturne/memory.md` e `.nocturne/rules.md`:
eles são arquivos do projeto, fora do backup portável, embora `workspace_memory`
tenha um espelho separado nos dados do aplicativo. Mantenha backups do projeto
ou um repositório Git remoto conforme sua política. Não copie secrets de
Providers para tornar um backup portável.
