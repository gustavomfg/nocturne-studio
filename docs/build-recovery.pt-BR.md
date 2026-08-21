# Recuperação do Build Mode

[English](build-recovery.md)

Antes de um Build, o Nocturne registra o estado Git do workspace autorizado.
Rollback só é oferecido quando existe commit `HEAD`, o workspace estava limpo,
o agente informou os caminhos alterados e todos permanecem contidos na raiz
autorizada.

Após confirmação explícita, arquivos versionados informados são restaurados a
partir de `HEAD` e arquivos novos informados são removidos. Rollback não é
oferecido quando alterações anteriores do usuário tornam a atribuição insegura.
Se a restauração parar, o caminho da falha e o estado atual ficam visíveis para
inspeção; revise o diff antes de tentar novamente.
