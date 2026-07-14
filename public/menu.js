(() => {
  const menu = document.getElementById('main-menu');
  const open = document.getElementById('open-main-menu');
  const close = document.getElementById('close-main-menu');
  const backdrop = document.getElementById('main-menu-backdrop');
  if (!menu || !open || !close || !backdrop) return;
  const setExpanded = value => open.setAttribute('aria-expanded', String(value));
  const openMenu = () => {
    menu.hidden = false;
    document.body.classList.add('menu-open');
    setExpanded(true);
    close.focus();
  };
  const closeMenu = () => {
    menu.hidden = true;
    document.body.classList.remove('menu-open');
    setExpanded(false);
    open.focus();
  };
  open.addEventListener('click', openMenu);
  close.addEventListener('click', closeMenu);
  backdrop.addEventListener('click', closeMenu);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) closeMenu();
  });
})();
