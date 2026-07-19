(() => {
  const carousel = document.getElementById('app-carousel');
  const slides = [...document.querySelectorAll('.app-screenshot')];
  const dots = [...document.querySelectorAll('.carousel-dots [data-slide]')];
  const previous = document.getElementById('app-carousel-previous');
  const next = document.getElementById('app-carousel-next');
  if (!carousel || !slides.length || !previous || !next) return;

  let activeIndex = 0;
  const setActive = index => {
    activeIndex = Math.max(0, Math.min(index, slides.length - 1));
    dots.forEach((dot, dotIndex) => {
      dot.classList.toggle('active', dotIndex === activeIndex);
      if (dotIndex === activeIndex) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    previous.disabled = activeIndex === 0;
    next.disabled = activeIndex === slides.length - 1;
  };
  const show = index => {
    setActive(index);
    slides[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  previous.addEventListener('click', () => show(activeIndex - 1));
  next.addEventListener('click', () => show(activeIndex + 1));
  dots.forEach((dot, index) => dot.addEventListener('click', () => show(index)));
  carousel.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(activeIndex - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(activeIndex + 1); }
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(slides.indexOf(visible.target));
    }, { root: carousel, threshold: [0.55, 0.75] });
    slides.forEach(slide => observer.observe(slide));
  }
  setActive(0);
})();
