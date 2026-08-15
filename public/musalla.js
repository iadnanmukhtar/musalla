(() => {
  const optInDialog = document.querySelector('#opt-in-dialog');
  const changeDialog = document.querySelector('#change-assignment-dialog');
  const optOutDialog = document.querySelector('#opt-out-dialog');
  const adminOptInDialog = document.querySelector('#admin-opt-in-dialog');
  const adminOptOutDialog = document.querySelector('#admin-opt-out-dialog');
  if (!optInDialog || !changeDialog || !optOutDialog) return;
  const optInTitle = optInDialog.querySelector('#opt-in-title');
  const optInDescription = optInDialog.querySelector('#opt-in-description');
  const optInOnce = optInDialog.querySelector('#opt-in-once');
  const optInWeekly = optInDialog.querySelector('#opt-in-weekly');
  const changeTitle = changeDialog.querySelector('#change-assignment-title');
  const changeDescription = changeDialog.querySelector('#change-assignment-description');
  const changeOnce = changeDialog.querySelector('#change-once');
  const changeFuture = changeDialog.querySelector('#change-future');
  const optOutTitle = optOutDialog?.querySelector('#opt-out-title');
  const optOutDescription = optOutDialog?.querySelector('#opt-out-description');
  const optOutReason = optOutDialog?.querySelector('#opt-out-reason');
  const optOutOnce = optOutDialog?.querySelector('#opt-out-once');
  const optOutFuture = optOutDialog?.querySelector('#opt-out-future');
  const adminOptInTitle = adminOptInDialog?.querySelector('#admin-opt-in-title');
  const adminOptInDescription = adminOptInDialog?.querySelector('#admin-opt-in-description');
  const adminOptInImam = adminOptInDialog?.querySelector('#admin-opt-in-imam');
  const adminOptInOnce = adminOptInDialog?.querySelector('#admin-opt-in-once');
  const adminOptInWeekly = adminOptInDialog?.querySelector('#admin-opt-in-weekly');
  const adminOptOutTitle = adminOptOutDialog?.querySelector('#admin-opt-out-title');
  const adminOptOutDescription = adminOptOutDialog?.querySelector('#admin-opt-out-description');
  const adminOptOutReason = adminOptOutDialog?.querySelector('#admin-opt-out-reason');
  const adminOptOutOnce = adminOptOutDialog?.querySelector('#admin-opt-out-once');
  const adminOptOutFuture = adminOptOutDialog?.querySelector('#admin-opt-out-future');
  let pendingOptInForm;
  let pendingChangeForm;
  let pendingOptOutForm;
  let pendingAdminOptInForm;
  let pendingAdminOptOutForm;

  const setHiddenValue = (form, name, value) => {
    let input = form.querySelector(`[name="${name}"]`);
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.append(input);
    }
    input.value = value;
  };

  const slotTiming = form => {
    const value = new Date(`${form.dataset.date}T12:00:00Z`);
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(value);
    const date = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(value);
    return { weekday, date: `${weekday}, ${date}` };
  };

  document.querySelectorAll('form[data-schedule-action="admin-opt-in"]').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      pendingAdminOptInForm = form;
      const timing = slotTiming(form);
      adminOptInTitle.textContent = `Assign ${form.dataset.prayer} on ${timing.weekday}`;
      adminOptInDescription.textContent = `Would you like to assign this Imam on ${timing.date} only, or every ${timing.weekday} beginning that date?`;
      adminOptInOnce.textContent = `This ${timing.weekday}`;
      adminOptInWeekly.textContent = `Every ${timing.weekday}`;
      adminOptInImam.value = '';
      adminOptInDialog.showModal();
      adminOptInImam.focus();
    });
  });

  document.querySelectorAll('form[data-schedule-action="admin-opt-out"]').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      pendingAdminOptOutForm = form;
      const timing = slotTiming(form);
      adminOptOutTitle.textContent = `Opt ${form.dataset.imam} out of ${form.dataset.prayer} on ${timing.weekday}?`;
      adminOptOutDescription.textContent = `Would you like to opt ${form.dataset.imam} out on ${timing.date} only, or on that date and every ${timing.weekday} after it?`;
      adminOptOutOnce.textContent = `This ${timing.weekday}`;
      adminOptOutFuture.textContent = `This & future ${timing.weekday}s`;
      adminOptOutReason.value = '';
      adminOptOutDialog.showModal();
    });
  });

  document.querySelectorAll('form[data-schedule-action="opt-in"]').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      pendingOptInForm = form;
      const timing = slotTiming(form);
      optInTitle.textContent = `Lead ${form.dataset.prayer} on ${timing.weekday}?`;
      optInDescription.textContent = `Would you like to lead on ${timing.date} only, or every ${timing.weekday} beginning that date?`;
      optInOnce.textContent = `This ${timing.weekday}`;
      optInWeekly.textContent = `Every ${timing.weekday}`;
      optInDialog.showModal();
    });
  });

  document.querySelectorAll('form[data-schedule-action="replace"]').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      pendingChangeForm = form;
      const timing = slotTiming(form);
      changeTitle.textContent = `Replace ${form.dataset.imam} for ${form.dataset.prayer} on ${timing.weekday}?`;
      changeDescription.textContent = `Would you like to replace ${form.dataset.imam} on ${timing.date} only, or on that date and every ${timing.weekday} after it?`;
      changeOnce.textContent = `This ${timing.weekday}`;
      changeFuture.textContent = `This & future ${timing.weekday}s`;
      changeDialog.showModal();
    });
  });

  document.querySelectorAll('form[data-schedule-action="opt-out"]').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      pendingOptOutForm = form;
      const timing = slotTiming(form);
      optOutTitle.textContent = `Opt out of ${form.dataset.prayer} on ${timing.weekday}?`;
      optOutDescription.textContent = `Would you like to opt out on ${timing.date} only, or on that date and every ${timing.weekday} after it?`;
      optOutOnce.textContent = `This ${timing.weekday}`;
      optOutFuture.textContent = `This & future ${timing.weekday}s`;
      optOutReason.value = '';
      optOutDialog.showModal();
      optOutReason.focus();
    });
  });

  const submitOptIn = (event, scope) => {
    event.preventDefault();
    if (!pendingOptInForm) return;
    pendingOptInForm.querySelector('[name="change_scope"]').value = scope;
    optInDialog.close();
    pendingOptInForm.submit();
  };
  optInOnce.addEventListener('click', event => submitOptIn(event, 'occurrence'));
  optInWeekly.addEventListener('click', event => submitOptIn(event, 'future'));

  const submitAdminOptIn = (event, scope) => {
    event.preventDefault();
    if (!pendingAdminOptInForm || !adminOptInImam.reportValidity()) return;
    setHiddenValue(pendingAdminOptInForm, 'imam_user_id', adminOptInImam.value);
    pendingAdminOptInForm.querySelector('[name="change_scope"]').value = scope;
    adminOptInDialog.close();
    pendingAdminOptInForm.submit();
  };
  adminOptInOnce?.addEventListener('click', event => submitAdminOptIn(event, 'occurrence'));
  adminOptInWeekly?.addEventListener('click', event => submitAdminOptIn(event, 'future'));

  const submitAdminOptOut = (event, scope) => {
    event.preventDefault();
    if (!pendingAdminOptOutForm) return;
    setHiddenValue(pendingAdminOptOutForm, 'opt_out_reason', adminOptOutReason.value.trim());
    pendingAdminOptOutForm.querySelector('[name="change_scope"]').value = scope;
    adminOptOutDialog.close();
    pendingAdminOptOutForm.submit();
  };
  adminOptOutOnce?.addEventListener('click', event => submitAdminOptOut(event, 'occurrence'));
  adminOptOutFuture?.addEventListener('click', event => submitAdminOptOut(event, 'future'));

  const submitChange = (event, scope) => {
    event.preventDefault();
    if (!pendingChangeForm) return;
    pendingChangeForm.querySelector('[name="change_scope"]').value = scope;
    changeDialog.close();
    pendingChangeForm.submit();
  };
  changeOnce.addEventListener('click', event => submitChange(event, 'occurrence'));
  changeFuture.addEventListener('click', event => submitChange(event, 'future'));

  const submitOptOut = (event, scope) => {
    event.preventDefault();
    if (!pendingOptOutForm) return;
    setHiddenValue(pendingOptOutForm, 'opt_out_reason', optOutReason.value.trim());
    pendingOptOutForm.querySelector('[name="change_scope"]').value = scope;
    optOutDialog.close();
    pendingOptOutForm.submit();
  };
  optOutOnce?.addEventListener('click', event => submitOptOut(event, 'occurrence'));
  optOutFuture?.addEventListener('click', event => submitOptOut(event, 'future'));
})();
