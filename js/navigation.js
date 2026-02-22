// navigation.js
// Responsive navigation and menu functionality

// Function to toggle the navigation menu
function toggleMenu() {
    const menu = document.getElementById('nav-menu');
    menu.classList.toggle('active');
}

// Event listener for the menu button
const menuButton = document.getElementById('menu-button');
if (menuButton) {
    menuButton.addEventListener('click', toggleMenu);
}

// Close the menu when a link is clicked
const navLinks = document.querySelectorAll('#nav-menu a');
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        const menu = document.getElementById('nav-menu');
        menu.classList.remove('active');
    });
});

// Adjust menu for responsive design
window.addEventListener('resize', () => {
    const menu = document.getElementById('nav-menu');
    if (window.innerWidth > 768) {
        menu.classList.remove('active');
    }
});
