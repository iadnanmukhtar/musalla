(() => {
  const dialog = document.querySelector('#opt-in-dialog');
  if (!dialog) return;
  const daysInput = dialog.querySelector('#opt-in-days');
  const title = dialog.querySelector('#opt-in-title');
  const confirm = dialog.querySelector('#confirm-opt-in');
  const optOutDialog = document.querySelector('#opt-out-dialog');
  const optOutReason = optOutDialog?.querySelector('#opt-out-reason');
  const confirmOptOut = optOutDialog?.querySelector('#confirm-opt-out');
  let pendingForm;
  let pendingOptOutForm;

  document.querySelectorAll('form[data-multi-day-opt-in]').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      pendingForm = form;
      daysInput.value = 1;
      daysInput.max = form.dataset.maxDays;
      title.textContent = `Lead ${form.dataset.prayer}`;
      dialog.showModal();
      daysInput.focus();
      daysInput.select();
    });
  });

  document.querySelectorAll('.week-slot button[aria-label^="Release your"]').forEach(button => {
    const form = button.closest('form');
    form.addEventListener('submit', event => {
      event.preventDefault();
      pendingOptOutForm = form;
      optOutReason.value = '';
      optOutDialog.showModal();
      optOutReason.focus();
    });
  });

  confirm.addEventListener('click', event => {
    event.preventDefault();
    if (!daysInput.reportValidity() || !pendingForm) return;
    pendingForm.querySelector('[name="days"]').value = daysInput.value;
    dialog.close();
    pendingForm.submit();
  });

  confirmOptOut?.addEventListener('click', event => {
    event.preventDefault();
    if (!pendingOptOutForm) return;
    const reasonInput = document.createElement('input');
    reasonInput.type = 'hidden';
    reasonInput.name = 'opt_out_reason';
    reasonInput.value = optOutReason.value.trim();
    pendingOptOutForm.append(reasonInput);
    optOutDialog.close();
    pendingOptOutForm.submit();
  });
})();
