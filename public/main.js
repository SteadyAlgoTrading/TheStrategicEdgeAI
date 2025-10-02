// Pricing toggle
const toggleBtns = document.querySelectorAll('.toggle-btn');
const priceEls = document.querySelectorAll('.price__value');
const suffixEls = document.querySelectorAll('.price__suffix');
const annualNotes = document.querySelectorAll('.annual-note');

function setBilling(mode) {
  toggleBtns.forEach(b => b.classList.toggle('active', b.dataset.billing === mode));
  priceEls.forEach(el => {
    const monthly = Number(el.getAttribute('data-monthly'));
    const annual = Number(el.getAttribute('data-annual'));
    if (mode === 'annual' && annual) {
      el.textContent = `$${annual}`;
    } else {
      el.textContent = `$${monthly}`;
    }
  });
  suffixEls.forEach(s => s.textContent = '/mo');
  annualNotes.forEach(n => n.style.display = mode === 'annual' ? 'block' : 'block'); // keep note visible
}

toggleBtns.forEach(btn => btn.addEventListener('click', () => setBilling(btn.dataset.billing)));
setBilling('monthly');

// Simple testimonials carousel
const carousel = document.querySelector('[data-carousel]');
if (carousel) {
  const slides = Array.from(carousel.querySelectorAll('.testimonial'));
  const prev = carousel.querySelector('.carousel__prev');
  const next = carousel.querySelector('.carousel__next');
  let i = 0;
  const show = idx => {
    slides.forEach(s => s.classList.remove('is-active'));
    slides[idx].classList.add('is-active');
  };
  prev.addEventListener('click', () => { i = (i - 1 + slides.length) % slides.length; show(i); });
  next.addEventListener('click', () => { i = (i + 1) % slides.length; show(i); });
  show(0);
}
