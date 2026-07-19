(() => {
  const prompt = document.getElementById('install-app-prompt');
  const installButton = document.getElementById('install-app-button');
  const closeButton = document.getElementById('install-app-close');
  const message = document.getElementById('install-app-message');
  if (!prompt || !installButton || !closeButton || !message) return;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = /iPhone|iPad|iPod/i.test(window.navigator.userAgent);
  const dismissedForSession = window.sessionStorage.getItem('musalla-install-dismissed') === '1';
  let deferredPrompt = null;
  let fallbackShown = false;

  if (isStandalone || dismissedForSession) return;

  const setPromptVisible = visible => {
    prompt.hidden = !visible;
    document.body.classList.toggle('install-prompt-visible', visible);
  };

  const dismiss = () => {
    setPromptVisible(false);
    window.sessionStorage.setItem('musalla-install-dismissed', '1');
  };

  closeButton.addEventListener('click', dismiss);
  window.addEventListener('appinstalled', () => {
    setPromptVisible(false);
    deferredPrompt = null;
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    setPromptVisible(true);
  });

  if (isIos) {
    if (window.location.pathname !== '/') {
      message.textContent = 'Continue to the Musalla home page before adding it to your Home Screen.';
      installButton.textContent = 'Continue';
      installButton.addEventListener('click', () => window.location.assign('/'));
      setPromptVisible(true);
      return;
    }
    message.textContent = 'Tap the Share button, then choose Add to Home Screen.';
    installButton.textContent = 'Got it';
    installButton.addEventListener('click', dismiss);
    setPromptVisible(true);
    return;
  }

  setPromptVisible(true);
  installButton.addEventListener('click', async () => {
    if (!deferredPrompt) {
      if (fallbackShown) {
        dismiss();
        return;
      }
      message.textContent = 'Open your browser menu, then choose Install app or Add to Home screen.';
      installButton.textContent = 'Got it';
      fallbackShown = true;
      return;
    }
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    setPromptVisible(false);
    if (choice.outcome !== 'accepted') {
      window.sessionStorage.setItem('musalla-install-dismissed', '1');
    }
  });
})();
