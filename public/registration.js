(() => {
  const form = document.querySelector('#registration-form');
  if (!form) return;
  form.addEventListener('submit', event => {
    const selected = form.querySelector('input[name="musalla_ids"]:checked');
    if (selected) return;
    event.preventDefault();
    window.showToast('Select at least one Musalla.', { type: 'error' });
  });
})();
