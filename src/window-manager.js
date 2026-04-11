(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;

    /**
     * Make an overlay draggable with a header.
     * @param {HTMLDivElement} box - The overlay element
     * @param {HTMLDivElement} header - The header element to grab for dragging
     */
    function makeDraggable(box, header) {
        let isDragging = false;
        let currentX = 0;
        let currentY = 0;
        let initialX = 0;
        let initialY = 0;

        header.style.cursor = 'grab';
        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            initialX = e.clientX - box.offsetLeft;
            initialY = e.clientY - box.offsetTop;
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            box.style.left = currentX + 'px';
            box.style.top = currentY + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            header.style.cursor = 'grab';
            
            // Save position after drag ends
            if (NLS.storage && box.id) {
                NLS.storage.saveWindowRect(box.id, {
                    top: box.offsetTop,
                    left: box.offsetLeft,
                    width: box.offsetWidth,
                    height: box.offsetHeight
                });
            }
        });
    }

    /**
     * Make an overlay resizable with a resize handle.
     * @param {HTMLDivElement} box - The overlay element
     * @param {number} minWidth - Minimum width in pixels
     * @param {number} minHeight - Minimum height in pixels
     */
    function makeResizable(box, minWidth = 300, minHeight = 200) {
        const handle = document.createElement('div');
        handle.style.position = 'absolute';
        handle.style.bottom = '0';
        handle.style.right = '0';
        handle.style.width = '16px';
        handle.style.height = '16px';
        handle.style.cursor = 'nwse-resize';
        handle.style.background = 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.3) 50%)';
        handle.style.pointerEvents = 'auto';
        box.appendChild(handle);

        let isResizing = false;
        let startX = 0;
        let startY = 0;
        let startWidth = 0;
        let startHeight = 0;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = box.offsetWidth;
            startHeight = box.offsetHeight;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = Math.max(minWidth, startWidth + (e.clientX - startX));
            const newHeight = Math.max(minHeight, startHeight + (e.clientY - startY));
            box.style.width = newWidth + 'px';
            box.style.height = newHeight + 'px';
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
            
            // Save size after resize ends
            if (NLS.storage && box.id) {
                NLS.storage.saveWindowRect(box.id, {
                    top: box.offsetTop,
                    left: box.offsetLeft,
                    width: box.offsetWidth,
                    height: box.offsetHeight
                });
            }
        });
    }

    /**
     * Create a hide/show button for an overlay.
     * @param {HTMLDivElement} box - The overlay element
     * @param {string} overlayName - The name of the overlay (for storage key)
     * @returns {HTMLButtonElement}
     */
    function createHideButton(box, overlayName) {
        const button = document.createElement('button');
        button.textContent = '✕';
        button.style.background = 'rgba(255,0,0,0.6)';
        button.style.border = 'none';
        button.style.color = '#fff';
        button.style.padding = '2px 6px';
        button.style.cursor = 'pointer';
        button.style.borderRadius = '3px';
        button.style.fontSize = '12px';
        button.style.fontWeight = 'bold';
        button.style.marginLeft = '6px';
        button.style.pointerEvents = 'auto';
        button.title = 'Hide this overlay';

        const storageKey = `nls_${overlayName}_hidden`;
        const isHidden = localStorage.getItem(storageKey) === 'true';
        if (isHidden) {
            box.style.display = 'none';
        }

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const hidden = box.style.display === 'none';
            box.style.display = hidden ? 'flex' : 'none';
            localStorage.setItem(storageKey, !hidden);
        });

        return button;
    }

    /**
     * Setup a window with dragging, resizing, and hide button.
     * @param {HTMLDivElement} box - The overlay element
     * @param {HTMLDivElement} header - The header element to grab for dragging
     * @param {string} overlayName - The name for storage and identification
     * @param {number} minWidth - Minimum width
     * @param {number} minHeight - Minimum height
     */
    function setupWindow(box, header, overlayName, minWidth = 300, minHeight = 200) {
        // Ensure box has absolute positioning for dragging/resizing
        if (box.style.position !== 'absolute' && box.style.position !== 'fixed') {
            box.style.position = 'absolute';
        }

        // Use overlay name as ID if not set
        if (!box.id) {
            box.id = overlayName;
        }

        // Load saved position if available
        if (NLS.storage) {
            const saved = NLS.storage.loadWindowRect(box.id);
            if (saved) {
                box.style.top = saved.top + 'px';
                box.style.left = saved.left + 'px';
                box.style.width = saved.width + 'px';
                box.style.height = saved.height + 'px';
            }
        }

        makeDraggable(box, header);
        makeResizable(box, minWidth, minHeight);
        const hideBtn = createHideButton(box, overlayName);
        header.appendChild(hideBtn);
    }

    NLS.makeDraggable = makeDraggable;
    NLS.makeResizable = makeResizable;
    NLS.createHideButton = createHideButton;
    NLS.setupWindow = setupWindow;
})();
