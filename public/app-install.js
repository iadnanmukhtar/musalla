(() => {
  const prompt = document.getElementById('install-app-prompt');
  const installButton = document.getElementById('install-app-button');
  const closeButton = document.getElementById('install-app-close');
  const message = document.getElementById('install-app-message');
  const instructions = document.getElementById('install-app-instructions');
  if (!prompt || !installButton || !closeButton || !message || !instructions) return;

  const displayMode = window.matchMedia('(display-mode: standalone)');
  const userAgent = window.navigator.userAgent;
  const isStandalone = displayMode.matches || window.navigator.standalone === true;
  const isIos = /iPhone|iPad|iPod/i.test(userAgent) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  const isIosSafari = isIos && /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  const isMacSafari = !isIos && /Macintosh/i.test(userAgent) && /Safari/i.test(userAgent) && !/Chrome|Chromium|Edg/i.test(userAgent);
  const dismissedForSession = window.sessionStorage.getItem('musalla-install-dismissed') === '1';
  let deferredPrompt = null;

  if (isStandalone || dismissedForSession) return;

  const track = (eventName, details = {}) => {
    if (typeof window.gtag === 'function') window.gtag('event', eventName, details);
  };

  const setPromptVisible = visible => {
    prompt.hidden = !visible;
    document.body.classList.toggle('install-prompt-visible', visible);
    document.body.classList.toggle('install-prompt-has-bottom-nav', visible && Boolean(document.querySelector('.bottom-nav')));
  };

  const dismiss = () => {
    setPromptVisible(false);
    window.sessionStorage.setItem('musalla-install-dismissed', '1');
    track('pwa_install_prompt_dismissed');
  };

  const showInstructions = text => {
    instructions.textContent = text;
    instructions.hidden = false;
    installButton.textContent = 'Got it';
    installButton.dataset.action = 'dismiss';
    track('pwa_install_instructions_shown');
  };

  const showNativeInstall = () => {
    instructions.hidden = true;
    instructions.textContent = '';
    message.textContent = 'Keep weekly Salah and Jumuah schedules one tap away.';
    installButton.textContent = 'Install app';
    installButton.dataset.action = 'install';
    setPromptVisible(true);
    track('pwa_install_prompt_ready');
  };

  const showFallback = () => {
    instructions.hidden = true;
    instructions.textContent = '';
    installButton.textContent = 'How to install';
    installButton.dataset.action = 'instructions';
    setPromptVisible(true);
  };

  closeButton.addEventListener('click', dismiss);
  window.addEventListener('appinstalled', () => {
    setPromptVisible(false);
    deferredPrompt = null;
    track('pwa_install_completed');
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    showNativeInstall();
  });

  if (isIos) {
    if (window.location.pathname !== '/') {
      message.textContent = 'Install Musalla from its home page so it always opens in the right place.';
      installButton.textContent = 'Go to home page';
      installButton.dataset.action = 'home';
      setPromptVisible(true);
    } else if (isIosSafari) {
      message.textContent = 'Add Musalla to your Home Screen for quick, app-like access.';
      showInstructions('Tap Share, then choose Add to Home Screen.');
      setPromptVisible(true);
    } else {
      message.textContent = 'Musalla can be installed from Safari on this device.';
      showInstructions('Open this page in Safari, tap Share, then choose Add to Home Screen.');
      setPromptVisible(true);
    }
  } else {
    showFallback();
  }

  installButton.addEventListener('click', async () => {
    const action = installButton.dataset.action;
    if (action === 'dismiss') {
      dismiss();
      return;
    }
    if (action === 'home') {
      window.location.assign('/');
      return;
    }
    if (action === 'instructions' || !deferredPrompt) {
      if (isAndroid) showInstructions('Open your browser menu, then choose Install app or Add to Home screen.');
      else if (isMacSafari) showInstructions('In Safari, choose File, then Add to Dock.');
      else showInstructions('Open your browser menu, then choose Install Musalla or Install app.');
      return;
    }

    const installEvent = deferredPrompt;
    deferredPrompt = null;
    installButton.disabled = true;
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      track('pwa_install_choice', { outcome: choice.outcome });
      setPromptVisible(false);
      if (choice.outcome !== 'accepted') window.sessionStorage.setItem('musalla-install-dismissed', '1');
    } catch (_error) {
      showFallback();
    } finally {
      installButton.disabled = false;
    }
  });
})();
