(() => {
  const form = document.querySelector('#registration-form');
  if (!form) return;
  const error = document.querySelector('#registration-error');
  form.addEventListener('submit', event => {
    const selected = form.querySelector('input[name="musalla_ids"]:checked');
    if (selected) return;
    event.preventDefault();
    error.hidden = false;
  });
})();
