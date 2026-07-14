(() => {
  const dialog = document.querySelector('#confirmation-dialog');
  if (!dialog) return;

  const title = dialog.querySelector('#confirmation-title');
  const message = dialog.querySelector('#confirmation-message');
  const confirmButton = dialog.querySelector('#confirmation-continue');
  let pendingForm = null;

  document.addEventListener('submit', event => {
    if (event.defaultPrevented) return;
    const form = event.target.closest('form[data-confirm]');
    if (!form) return;
    event.preventDefault();
    pendingForm = form;
    title.textContent = form.dataset.confirmTitle || 'Confirm membership action';
    message.textContent = form.dataset.confirm;
    confirmButton.textContent = form.dataset.confirmButton || 'Confirm';
    confirmButton.classList.toggle('danger', form.dataset.confirmStyle === 'danger');
    dialog.showModal();
  });

  const close = () => {
    pendingForm = null;
    dialog.close();
  };
  dialog.querySelector('#confirmation-close').addEventListener('click', close);
  dialog.querySelector('#confirmation-cancel').addEventListener('click', close);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('cancel', () => { pendingForm = null; });
  confirmButton.addEventListener('click', () => {
    if (!pendingForm) return;
    const form = pendingForm;
    pendingForm = null;
    dialog.close();
    HTMLFormElement.prototype.submit.call(form);
  });
})();
