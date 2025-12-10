document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.favorite-toggle');
  if (btn) {
    const productId = btn.getAttribute('data-product-id');
    try {
      const res = await fetch('/favorites/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId })
      });
      if (res.status === 401) {
        alert('Please login to manage favorites.');
        return;
      }
      const data = await res.json();
      btn.classList.toggle('btn-success', true);
      btn.classList.toggle('btn-outline-success', true);
    } catch (err) {
      console.error(err);
    }
  }
});
