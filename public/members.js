(() => {
  const dialog = document.querySelector('[data-add-member-dialog]');
  const openButton = document.querySelector('[data-add-member-open]');
  const closeButton = dialog?.querySelector('[data-add-member-close]');
  if (!dialog || !openButton || !closeButton) return;

  openButton.addEventListener('click', () => {
    dialog.showModal();
    dialog.querySelector('input[name="email"]')?.focus();
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
})();
