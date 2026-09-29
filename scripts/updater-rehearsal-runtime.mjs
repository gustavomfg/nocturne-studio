// Only for the disposable rehearsal's own loopback server, never product HTTP.
export function closeRehearsalServer(server) {
  const closed = new Promise((resolve) => server.close(() => resolve()))
  // server.close alone can wait forever for incomplete/active requests. These
  // connections belong exclusively to this disposable loopback fixture.
  server.closeAllConnections()
  return closed
}

export async function runRehearsalPhase(label, action, timeoutMs = 120_000) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Updater rehearsal timed out in ${label}.`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
