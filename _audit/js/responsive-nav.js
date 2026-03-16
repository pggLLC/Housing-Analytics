// responsive-nav.js - Fix dropdown menu on browser resize
// Version: 1.0 - February 2026
// Fixes issue where mobile menu doesn't properly reset when resizing browser

(function() {
    'use strict';
    
    const mobileBreakpoint = 768;
    let isMobile = window.innerWidth <= mobileBreakpoint;
    
    function initMobileMenu() {
        const nav = document.querySelector('nav');
        if (!nav) return;
        
        let toggleBtn = document.querySelector('.mobile-menu-toggle');
        if (!toggleBtn) {
            toggleBtn = document.createElement('button');
            toggleBtn.className = 'mobile-menu-toggle';
            toggleBtn.innerHTML = '☰';
            toggleBtn.setAttribute('aria-label', 'Toggle mobile menu');
            toggleBtn.setAttribute('aria-expanded', 'false');
            nav.insertBefore(toggleBtn, nav.firstChild);
        }
        
        const navList = nav.querySelector('ul');
        if (!navList) return;
        
        toggleBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const isActive = navList.classList.toggle('mobile-active');
            toggleBtn.setAttribute('aria-expanded', isActive);
            toggleBtn.innerHTML = isActive ? '✕' : '☰';
        });
        
        const dropdownParents = nav.querySelectorAll('li:has(.dropdown)');
        dropdownParents.forEach(parent => {
            const link = parent.querySelector(':scope > a');
            if (link) {
                link.addEventListener('click', function(e) {
                    if (window.innerWidth <= mobileBreakpoint) {
                        e.preventDefault();
                        parent.classList.toggle('mobile-dropdown-active');
                    }
                });
            }
        });
        
        document.addEventListener('click', function(e) {
            if (window.innerWidth <= mobileBreakpoint && !nav.contains(e.target)) {
                navList.classList.remove('mobile-active');
                toggleBtn.setAttribute('aria-expanded', 'false');
                toggleBtn.innerHTML = '☰';
            }
        });
    }
    
    function handleResize() {
        const nowMobile = window.innerWidth <= mobileBreakpoint;
        
        if (isMobile !== nowMobile) {
            isMobile = nowMobile;
            const nav = document.querySelector('nav ul');
            const toggleBtn = document.querySelector('.mobile-menu-toggle');
            
            if (nav) nav.classList.remove('mobile-active');
            if (toggleBtn) {
                toggleBtn.setAttribute('aria-expanded', 'false');
                toggleBtn.innerHTML = '☰';
            }
            
            document.querySelectorAll('.mobile-dropdown-active').forEach(el => {
                el.classList.remove('mobile-dropdown-active');
            });
        }
    }
    
    let resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(handleResize, 250);
    });
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileMenu);
    } else {
        initMobileMenu();
    }
})();
