(() => {
  const input = document.querySelector('#profile-photo-input');
  const preview = document.querySelector('#profile-photo-preview');
  if (!input || !preview) return;
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    document.querySelector('#profile-photo-placeholder')?.remove();
  });
})();
