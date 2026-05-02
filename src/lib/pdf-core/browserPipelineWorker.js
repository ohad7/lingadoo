self.addEventListener('message', async (event) => {
  const requestId = String(event?.data?.requestId || '');
  const operation = String(event?.data?.operation || '');
  console.info('[browser-pipeline-worker] received request', { requestId, operation });
  try {
    console.info('[browser-pipeline-worker] loading pipeline core', { requestId, operation });
    const { handleBrowserPipelineRequest } = await import('./browserPipelineCore.js');
    console.info('[browser-pipeline-worker] pipeline core loaded', { requestId, operation });
    const response = await handleBrowserPipelineRequest(event.data);
    console.info('[browser-pipeline-worker] completed request', {
      requestId,
      operation,
      ok: response?.ok === true,
    });
    self.postMessage(response);
  } catch (error) {
    console.error('[browser-pipeline-worker] request crashed', {
      requestId,
      operation,
      message: error instanceof Error ? error.message : String(error),
    });
    self.postMessage({
      ok: false,
      requestId,
      operation,
      error: {
        code: 'internal_error',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
