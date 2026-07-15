(() => {
  const dialog = document.querySelector('#confirmation-dialog');
  if (!dialog) return;

  const title = dialog.querySelector('#confirmation-title');
  const message = dialog.querySelector('#confirmation-message');
  const confirmButton = dialog.querySelector('#confirmation-continue');
  let pendingForm = null;
  let pendingSubmitter = null;

  document.addEventListener('submit', event => {
    if (event.defaultPrevented) return;
    const form = event.target.closest('form[data-confirm]');
    if (!form) return;
    if (form.dataset.confirmBypass === 'true') {
      delete form.dataset.confirmBypass;
      return;
    }
    event.preventDefault();
    pendingForm = form;
    pendingSubmitter = event.submitter || null;
    title.textContent = pendingSubmitter?.dataset.confirmTitle || form.dataset.confirmTitle || 'Confirm membership action';
    message.textContent = pendingSubmitter?.dataset.confirm || form.dataset.confirm;
    confirmButton.textContent = pendingSubmitter?.dataset.confirmButton || form.dataset.confirmButton || 'Confirm';
    confirmButton.classList.toggle('danger', (pendingSubmitter?.dataset.confirmStyle || form.dataset.confirmStyle) === 'danger');
    dialog.showModal();
  });

  const close = () => {
    pendingForm = null;
    pendingSubmitter = null;
    dialog.close();
  };
  dialog.querySelector('#confirmation-close').addEventListener('click', close);
  dialog.querySelector('#confirmation-cancel').addEventListener('click', close);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('cancel', () => { pendingForm = null; pendingSubmitter = null; });
  confirmButton.addEventListener('click', () => {
    if (!pendingForm) return;
    const form = pendingForm;
    const submitter = pendingSubmitter;
    pendingForm = null;
    pendingSubmitter = null;
    dialog.close();
    if (submitter) {
      form.dataset.confirmBypass = 'true';
      form.requestSubmit(submitter);
    } else {
      HTMLFormElement.prototype.submit.call(form);
    }
  });

  const successDialog = document.querySelector('#registration-success-dialog');
  if (successDialog) {
    const closeSuccess = () => successDialog.close();
    successDialog.querySelector('#registration-success-close').addEventListener('click', closeSuccess);
    successDialog.querySelector('#registration-success-continue').addEventListener('click', closeSuccess);
    successDialog.addEventListener('click', event => {
      if (event.target === successDialog) closeSuccess();
    });
    successDialog.showModal();
  }
})();
