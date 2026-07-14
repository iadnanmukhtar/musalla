(() => {
  const dialog = document.querySelector('#invite-dialog');
  if (!dialog) return;
  const card = dialog.querySelector('.dialog-card');
  const message = card.dataset.inviteMessage;
  const messageField = dialog.querySelector('#invite-message');
  const whatsapp = dialog.querySelector('#share-whatsapp');
  const shareButton = dialog.querySelector('#share-invite');
  const feedback = dialog.querySelector('#invite-feedback');
  messageField.value = message;
  whatsapp.href = `https://wa.me/?text=${encodeURIComponent(message)}`;

  document.querySelector('#open-invite').addEventListener('click', () => dialog.showModal());
  document.querySelector('#close-invite').addEventListener('click', () => dialog.close());
  shareButton.addEventListener('click', async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Imam invitation', text: message });
        feedback.textContent = 'Invitation shared.';
      } else {
        await navigator.clipboard.writeText(message);
        feedback.textContent = 'Invitation copied to your clipboard.';
      }
    } catch (error) {
      if (error.name !== 'AbortError') feedback.textContent = 'Unable to share. Copy the message above instead.';
    }
  });
})();
