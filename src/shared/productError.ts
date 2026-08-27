export interface ProductErrorExplanation {
  title: string
  cause: string
  preserved: string
  resolution: string
  retryable: boolean
}

export function explainProductError(message: string, language: 'pt-BR' | 'en' = 'pt-BR'): ProductErrorExplanation {
  const normalized = message.toLocaleLowerCase()
  const english = language === 'en'
  const preserved = english
    ? 'The conversation and saved data were preserved. The incomplete operation was not marked as completed.'
    : 'A conversa e os dados já salvos foram preservados. A operação incompleta não foi marcada como concluída.'
  if (/insufficient_quota|quota exceeded|sem cr[eé]ditos|cr[eé]ditos insuficientes|billing/.test(normalized)) {
    return { title: english ? 'Insufficient API credits' : 'Créditos insuficientes na API', cause: message, preserved, resolution: english ? 'Add credits to the API account or select the ChatGPT account or another configured provider.' : 'Adicione créditos à conta da API ou selecione a conta ChatGPT ou outro Provider configurado.', retryable: false }
  }
  if (/unauthorized|not authenticated|n[aã]o autenticad|login|api.?key|chave.*inv[aá]lid|401/.test(normalized)) {
    return { title: english ? 'Authentication required' : 'Autenticação necessária', cause: message, preserved, resolution: english ? 'Open Settings → AI, sign in again, or review the provider credential.' : 'Abra Configurações → IA, autentique novamente ou revise a credencial do Provider.', retryable: false }
  }
  if (/rate.?limit|muitas solicita|429/.test(normalized)) {
    return { title: english ? 'Temporary provider limit' : 'Limite temporário do Provider', cause: message, preserved, resolution: english ? 'Wait for the interval indicated by the provider and try again.' : 'Aguarde o intervalo indicado pelo Provider e tente novamente.', retryable: true }
  }
  if (/timeout|tempo permitido|excedeu o tempo/.test(normalized)) {
    return { title: english ? 'The operation timed out' : 'A operação excedeu o tempo limite', cause: message, preserved, resolution: english ? 'Check that the service is responding and try again. If it persists, open diagnostics.' : 'Verifique se o serviço está respondendo e tente novamente. Se persistir, abra o diagnóstico.', retryable: true }
  }
  if (/econn|network|fetch failed|dns|offline|conex[aã]o|inacess[ií]vel/.test(normalized)) {
    return { title: english ? 'The service could not be reached' : 'Não foi possível alcançar o serviço', cause: message, preserved, resolution: english ? 'Check the network and provider address, run connection diagnostics, and try again.' : 'Confira a rede e o endereço do Provider, execute o diagnóstico da conexão e tente novamente.', retryable: true }
  }
  if (/workspace|pasta do projeto|permiss|n[aã]o autorizad|fora do projeto/.test(normalized)) {
    return { title: english ? 'The workspace needs attention' : 'O workspace precisa de atenção', cause: message, preserved, resolution: english ? 'Reopen or reauthorize the correct folder and repeat the operation.' : 'Reabra ou reautorize a pasta correta e repita a operação.', retryable: false }
  }
  if (/banco|database|sqlite|migra|corromp|restaur/.test(normalized)) {
    return { title: english ? 'Local persistence could not complete the operation' : 'A persistência local não pôde concluir a operação', cause: message, preserved: english ? 'Studio stopped the operation to avoid a partial write. Previous data was preserved or kept in the reported recovery point.' : 'O Studio interrompeu a operação para evitar uma gravação parcial. Os dados anteriores foram preservados ou mantidos no ponto de recuperação informado.', resolution: english ? 'Open Diagnostics, preserve local files, and use recovery or a verified backup.' : 'Abra Diagnóstico, preserve os arquivos locais e use a recuperação ou um backup verificado.', retryable: false }
  }
  return { title: english ? 'The operation did not complete' : 'A operação não foi concluída', cause: message || (english ? 'The app received no additional failure details.' : 'O aplicativo não recebeu detalhes adicionais da falha.'), preserved, resolution: english ? 'Try again. If it persists, export sanitized diagnostics from Settings → Diagnostics.' : 'Tente novamente. Se a falha persistir, exporte o diagnóstico sanitizado em Configurações → Diagnóstico.', retryable: true }
}
