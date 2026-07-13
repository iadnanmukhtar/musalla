(() => {
  const filter = document.querySelector('#musalla-filter');
  if (!filter) return;
  const cards = [...document.querySelectorAll('[data-musalla-card]')];
  const count = document.querySelector('#musalla-count');
  const empty = document.querySelector('#no-filter-results');
  filter.addEventListener('input', () => {
    const query = filter.value.trim().toLowerCase();
    let visible = 0;
    for (const card of cards) {
      const matches = card.dataset.search.includes(query);
      card.hidden = !matches;
      if (matches) visible += 1;
    }
    count.textContent = visible;
    empty.hidden = visible > 0 || !query;
  });
})();
