document.addEventListener('DOMContentLoaded', () => {
    const TOTAL_MEMORY = 16 * 1024 * 1024; // 16 MiB in Bytes
    const OS_MEMORY_SIZE = 2 * 1024 * 1024; // 2 MiB for OS

    // --- DOM Elements ---
    const algorithmSelect = document.getElementById('algorithm');
    const dynamicAlgorithmSelect = document.getElementById('dynamic-algorithm');
    const coalesceCheckbox = document.getElementById('coalesce');
    const dynamicOptions = document.getElementById('dynamic-options');
    const staticOptions = document.getElementById('static-options');
    const resetMemoryButton = document.getElementById('reset-memory');
    const memoryDisplay = document.getElementById('memory-display');
    const processListDiv = document.getElementById('process-list');
    const addProcessButton = document.getElementById('add-process');
    const processSizeInput = document.getElementById('process-size');
    const processSizeUnitSelect = document.getElementById('process-size-unit');

    // --- State ---
    let memoryManager;
    let processes = [];
    let nextProcessId = 0;

    // --- Utility Functions ---
    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KiB', 'MiB', 'GiB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatAddress = (address) => {
        return `0x${address.toString(16).toUpperCase().padStart(8, '0')}`;
    };

    // --- Process Control Block (BCP) Class ---
    class ProcessControlBlock {
        constructor(id, size, name = `Process ${id}`) {
            this.id = id;
            this.name = name;
            this.size = size;
            this.allocated = false;
            this.partitionId = null; // Used in static, can be block address in dynamic
        }
    }

    // --- Memory Manager Classes ---
    class MemoryManager {
        constructor(totalSize) {
            this.totalSize = totalSize;
            this.memory = [];
        }
        allocate(process) { throw new Error("Not implemented"); }
        deallocate(processId) { throw new Error("Not implemented"); }
    }

    class StaticMemoryManager extends MemoryManager {
        constructor(totalSize) {
            super(totalSize);
            // Fixed partitions after OS: 1MiB, 2MiB, 4MiB, 8MiB, 1MiB
            const partitionSizes = [1, 2, 4, 8, 1].map(s => s * 1024 * 1024);
            let currentAddress = OS_MEMORY_SIZE;
            this.memory = partitionSizes.map((size, index) => {
                const partition = {
                    id: index,
                    address: currentAddress,
                    size: size,
                    free: true,
                    processId: null
                };
                currentAddress += size;
                return partition;
            });
        }

        allocate(process) {
            // First-fit algorithm
            for (const partition of this.memory) {
                if (partition.free && partition.size >= process.size) {
                    partition.free = false;
                    partition.processId = process.id;
                    process.allocated = true;
                    process.partitionId = partition.id;
                    return true;
                }
            }
            alert(`No suitable partition found for ${process.name} (${formatBytes(process.size)})`);
            return false;
        }

        deallocate(processId) {
            const partition = this.memory.find(p => p.processId === processId);
            if (partition) {
                partition.free = true;
                partition.processId = null;
                const process = processes.find(p => p.id === processId);
                if (process) {
                    process.allocated = false;
                    process.partitionId = null;
                }
            }
        }
    }

    class DynamicMemoryManager extends MemoryManager {
        constructor(totalSize, coalesceEnabled, fitAlgorithm) {
            super(totalSize);
            this.coalesceEnabled = coalesceEnabled;
            this.fitAlgorithm = fitAlgorithm;
            this.memory = [{
                address: OS_MEMORY_SIZE,
                size: totalSize - OS_MEMORY_SIZE,
                free: true,
                processId: null
            }];
        }

        allocate(process) {
            let blockIndex = -1;

            if (this.fitAlgorithm === 'first') {
                blockIndex = this._findFirstFit(process.size);
            } else if (this.fitAlgorithm === 'best') {
                blockIndex = this._findBestFit(process.size);
            } else if (this.fitAlgorithm === 'worst') {
                blockIndex = this._findWorstFit(process.size);
            }

            if (blockIndex !== -1) {
                const block = this.memory[blockIndex];
                const remainingSize = block.size - process.size;
                
                block.size = process.size;
                block.free = false;
                block.processId = process.id;
                process.allocated = true;
                process.partitionId = block.address;

                if (remainingSize > 0) {
                    this.memory.splice(blockIndex + 1, 0, {
                        address: block.address + process.size,
                        size: remainingSize,
                        free: true,
                        processId: null
                    });
                }
                return true;
            }

            alert(`Not enough contiguous memory for ${process.name} (${formatBytes(process.size)}) using ${this.fitAlgorithm}-fit.`);
            return false;
        }
        
        _findFirstFit(size) {
            return this.memory.findIndex(block => block.free && block.size >= size);
        }

        _findBestFit(size) {
            let bestIndex = -1;
            let minDiff = Infinity;

            this.memory.forEach((block, index) => {
                if (block.free && block.size >= size) {
                    const diff = block.size - size;
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestIndex = index;
                    }
                }
            });
            return bestIndex;
        }

        _findWorstFit(size) {
            let worstIndex = -1;
            let maxDiff = -Infinity;

            this.memory.forEach((block, index) => {
                if (block.free && block.size >= size) {
                    const diff = block.size - size;
                    if (diff > maxDiff) {
                        maxDiff = diff;
                        worstIndex = index;
                    }
                }
            });
            return worstIndex;
        }


        deallocate(processId) {
            const block = this.memory.find(b => b.processId === processId);
            if (block) {
                block.free = true;
                block.processId = null;
                const process = processes.find(p => p.id === processId);
                if (process) {
                    process.allocated = false;
                    process.partitionId = null;
                }
                if (this.coalesceEnabled) {
                    this.coalesce();
                }
            }
        }

        coalesce() {
            for (let i = 0; i < this.memory.length - 1; i++) {
                const current = this.memory[i];
                const next = this.memory[i + 1];
                if (current.free && next.free) {
                    current.size += next.size;
                    this.memory.splice(i + 1, 1);
                    i--; // Re-check in case of multiple contiguous free blocks
                }
            }
        }
    }

    // --- Rendering Functions ---
    function renderMemory() {
        memoryDisplay.innerHTML = '';

        // Render OS block first
        const osBlockDiv = document.createElement('div');
        const osPercentageHeight = (OS_MEMORY_SIZE / TOTAL_MEMORY) * 100;
        osBlockDiv.className = 'memory-block occupied';
        osBlockDiv.style.top = `0%`;
        osBlockDiv.style.height = `${osPercentageHeight}%`;
        osBlockDiv.innerHTML = `
            <span>Operating System<br>${formatBytes(OS_MEMORY_SIZE)}</span>
            <div class="address-info">
                ${formatAddress(0)} - ${formatAddress(OS_MEMORY_SIZE - 1)}
            </div>`;
        memoryDisplay.appendChild(osBlockDiv);

        // Render user memory blocks
        memoryManager.memory.forEach(block => {
            const blockDiv = document.createElement('div');
            const percentageHeight = (block.size / TOTAL_MEMORY) * 100;
            const percentageTop = (block.address / TOTAL_MEMORY) * 100;

            blockDiv.className = `memory-block ${block.free ? 'free' : 'occupied'}`;
            blockDiv.style.top = `${percentageTop}%`;
            blockDiv.style.height = `${percentageHeight}%`;
            
            const process = block.processId !== null ? processes.find(p => p.id === block.processId) : null;
            const processName = process ? process.name : 'Free';
            const startAddr = formatAddress(block.address);
            const endAddr = formatAddress(block.address + block.size - 1);
            
            blockDiv.innerHTML = `
                <span>${processName}<br>${formatBytes(block.size)}</span>
                <div class="address-info">${startAddr} - ${endAddr}</div>
            `;
            memoryDisplay.appendChild(blockDiv);
        });
    }

    function renderProcessList() {
        processListDiv.innerHTML = '';
        processes.forEach(process => {
            const processDiv = document.createElement('div');
            processDiv.className = 'process-item';
            processDiv.innerHTML = `
                <span>${process.name} (${formatBytes(process.size)})</span>
                ${process.allocated
                    ? `<button class="deallocate" data-id="${process.id}">Deallocate</button>`
                    : `<button class="allocate" data-id="${process.id}">Allocate</button>`
                }
            `;
            processListDiv.appendChild(processDiv);
        });
    }

    // --- Event Handlers ---
    function handleAlgorithmChange() {
        const isDynamic = algorithmSelect.value === 'dynamic';
        dynamicOptions.style.display = isDynamic ? 'flex' : 'none';
        staticOptions.style.display = isDynamic ? 'none' : 'block';
        initialize();
    }

    function initialize() {
        const algorithm = algorithmSelect.value;
        if (algorithm === 'static') {
            memoryManager = new StaticMemoryManager(TOTAL_MEMORY);
        } else {
            const coalesce = coalesceCheckbox.checked;
            const fitAlgorithm = dynamicAlgorithmSelect.value;
            memoryManager = new DynamicMemoryManager(TOTAL_MEMORY, coalesce, fitAlgorithm);
        }
        // Reset processes allocation status
        processes.forEach(p => {
            p.allocated = false;
            p.partitionId = null;
        });
        renderAll();
    }

    function createProcess(sizeInBytes) {
        if (isNaN(sizeInBytes) || sizeInBytes <= 0) {
            alert("Please enter a valid positive size for the process.");
            return;
        }
        const newProcess = new ProcessControlBlock(nextProcessId++, sizeInBytes);
        processes.push(newProcess);
        renderProcessList();
    }

    function handleAddProcessClick() {
        const size = parseInt(processSizeInput.value, 10);
        const unit = parseInt(processSizeUnitSelect.value, 10);
        createProcess(size * unit);
        processSizeInput.value = '';
    }

    function handleProcessListClick(e) {
        const target = e.target;
        const processId = parseInt(target.dataset.id, 10);
        const process = processes.find(p => p.id === processId);

        if (target.classList.contains('allocate')) {
            memoryManager.allocate(process);
        } else if (target.classList.contains('deallocate')) {
            memoryManager.deallocate(processId);
        }
        renderAll();
    }
    
    function renderAll() {
        renderMemory();
        renderProcessList();
    }

    // --- Initial Setup ---
    function setupInitialState() {
        // Create 5 default processes
        createProcess(512 * 1024);    // 512 KiB
        createProcess(1.5 * 1024 * 1024); // 1.5 MiB
        createProcess(3 * 1024 * 1024);   // 3 MiB
        createProcess(700 * 1024);    // 700 KiB
        createProcess(4 * 1024 * 1024);   // 4 MiB

        algorithmSelect.addEventListener('change', handleAlgorithmChange);
        dynamicAlgorithmSelect.addEventListener('change', initialize);
        coalesceCheckbox.addEventListener('change', initialize);
        resetMemoryButton.addEventListener('click', initialize);
        addProcessButton.addEventListener('click', handleAddProcessClick);
        processListDiv.addEventListener('click', handleProcessListClick);

        handleAlgorithmChange(); // Initial setup
    }

    setupInitialState();
});
