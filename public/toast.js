(() => {
  const region = document.querySelector('[data-toast-region]');
  if (!region) return;

  const dismissToast = toast => {
    if (!toast || toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    window.setTimeout(() => toast.remove(), 220);
  };

  const prepareToast = toast => {
    toast.querySelector('.toast-close')?.addEventListener('click', () => dismissToast(toast));
    const delay = Number(toast.dataset.toastAutoclose);
    if (delay > 0) window.setTimeout(() => dismissToast(toast), delay);
  };

  window.showToast = (message, { type = 'success', duration } = {}) => {
    const isError = type === 'error';
    const toast = document.createElement('div');
    toast.className = `toast toast-${isError ? 'error' : 'success'}`;
    toast.dataset.toast = '';
    toast.dataset.toastAutoclose = String(duration ?? (isError ? 7000 : 4500));
    toast.setAttribute('role', isError ? 'alert' : 'status');

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = isError ? '!' : '✓';

    const copy = document.createElement('span');
    copy.className = 'toast-message';
    copy.textContent = message;

    const close = document.createElement('button');
    close.className = 'toast-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';

    toast.append(icon, copy, close);
    region.append(toast);
    prepareToast(toast);
    return toast;
  };

  region.querySelectorAll('[data-toast]').forEach(prepareToast);
})();
