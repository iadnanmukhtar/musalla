(() => {
  const dialog = document.querySelector('#invite-dialog');
  if (!dialog) return;
  const card = dialog.querySelector('.dialog-card');
  const message = card.dataset.inviteMessage;
  const messageField = dialog.querySelector('#invite-message');
  const shareButton = dialog.querySelector('#share-invite');
  messageField.value = message;
  document.querySelector('#open-invite').addEventListener('click', () => dialog.showModal());
  document.querySelector('#close-invite').addEventListener('click', () => dialog.close());
  shareButton.addEventListener('click', async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Imam invitation', text: message });
        window.showToast('Invitation shared.');
      } else {
        await navigator.clipboard.writeText(message);
        window.showToast('Invitation copied to your clipboard.');
      }
    } catch (error) {
      if (error.name !== 'AbortError') window.showToast('Unable to share. Copy the message above instead.', { type: 'error' });
    }
  });
})();
