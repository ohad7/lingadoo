export function shouldShowStandaloneUploadError(uploadJob, previewError) {
  const message = String(previewError || '').trim();
  if (!message) {
    return false;
  }
  return String(uploadJob?.status || '') !== 'failed';
}
