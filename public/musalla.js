(() => {
  const dialog = document.querySelector('#opt-in-dialog');
  if (!dialog) return;
  const daysInput = dialog.querySelector('#opt-in-days');
  const title = dialog.querySelector('#opt-in-title');
  const confirm = dialog.querySelector('#confirm-opt-in');
  let pendingForm;

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

  confirm.addEventListener('click', event => {
    event.preventDefault();
    if (!daysInput.reportValidity() || !pendingForm) return;
    pendingForm.querySelector('[name="days"]').value = daysInput.value;
    dialog.close();
    pendingForm.submit();
  });
})();
