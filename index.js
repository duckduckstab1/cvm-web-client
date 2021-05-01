class VMWebsocket {
    constructor(ip, { onOpen = null, onMessage = null, onClose = null, onError = null }, reconnectOnDisconnect = false) {
        this.connIP = ip;
        this.reconnectOnDisconnect = reconnectOnDisconnect;
        this.eventCallbacks = { onOpen, onMessage, onClose, onError };
        this.makeAndConnectWS();
    }
    makeAndConnectWS() {
        if (window.location.protocol == 'https:') this.ws = new WebSocket(`wss://${this.connIP}/`, ['guacamole']);
        else this.ws = new WebSocket(`ws://${this.connIP}/`, ['guacamole']);
        if (this.eventCallbacks.onMessage !== null) {
            this.onMessage = this.eventCallbacks.onMessage.bind(this);
            this.ws.onmessage = this.onMessageWrapper.bind(this);
        }
        if (this.eventCallbacks.onOpen !== null) this.ws.onopen = this.eventCallbacks.onOpen.bind(this);
        if (this.eventCallbacks.onClose !== null) this.ws.onclose = this.reconnectOnDisconnect ? this.callOnCloseAndReconnect : this.eventCallbacks.onClose.bind(this);
        if (this.eventCallbacks.onError !== null) this.ws.onerror = this.eventCallbacks.onError.bind(this);
    }
    callOnCloseAndReconnect(ev) {
        this.eventCallbacks.onClose.bind(this);
        makeAndConnectWS();
    }
    onMessageWrapper(ev) {
        this.onMessage(this.decodeGuac(ev.data));
    }
    sendGuac(arr) {
        this.ws.send(this.encodeGuac(arr));
    }
    encodeGuac(arr) {
        let result = [];
        arr.forEach(v => { if (v !== undefined) result.push(v.length.toString() + '.' + v) });
        return result.join(',') + ';';
    }
    decodeGuac(str) {
        let result = [];
        for (let i = 0; i < str.length; i++) {
            let sectionLengthStr = [];
            for (; str[i] !== '.'; i++) {
                sectionLengthStr.push(str[i]);
            }
            i++;
            const sectionLength = parseInt(sectionLengthStr.join(''));
            if (sectionLength === NaN) throw new Error('sectionLength is NaN while decoding guacamole string' + str);
            result.push(str.substring(i, i + sectionLength));
            i += sectionLength;
            if (str[i] === ';') break;
        }
        return result;
    }
    disconnect() {
        this.sendGuac(['disconnect']);
        this.ws.close();
    }
}

let currentConn = null;
let currentUsername = null;

function cancelEvent(e) {
    e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
    e.returnValue = false;
}

class VMDisplay {
    constructor() {
        this.size = { x: null, y: null };
        this.canvas = $('#vm-canvas').get(0);
        this.context = this.canvas.getContext('2d');
        $(this.canvas).prop('tabindex', 1);
        this.canvas.onclick = () => {
            if ($('#turn-btn').is(':visible')) {
                $('#turn-btn').click(); // get turn if we don't have turn
            }
            this.canvas.focus();
        };
        // mouse move handling
        this.mouseLeft = false;
        this.mouseRight = false;
        this.mouseMiddle = false;

        let updateMouseBtnVars = e => {
            this.mouseLeft = (e.buttons & 0b001) == 0b001;
            this.mouseRight = (e.buttons & 0b010) == 0b010;
            this.mouseMiddle = (e.buttons & 0b100) == 0b100;
        }
        let sendMouse = (x, y) => {
            let btnMask = 0;
            if (this.mouseLeft) btnMask |= 1;
            if (this.mouseMiddle) btnMask |= 2;
            if (this.mouseRight) btnMask |= 4;
            currentConn.sendGuac(['mouse', Math.floor(x).toString(), Math.floor(y).toString(), btnMask.toString()]);
        };

        this.canvas.oncontextmenu = e => {
            cancelEvent(e);
        };
        let onmouse = e => {
            cancelEvent(e);
            updateMouseBtnVars(e);
            let rect = e.target.getBoundingClientRect();
            let x = e.clientX - rect.left;
            let y = e.clientY - rect.top;
            sendMouse(x, y);
        };
        this.canvas.onmouseup = onmouse;
        this.canvas.onmousedown = onmouse;
        this.canvas.onmousemove = onmouse;

        // keyboard input handling
        let isShiftDown = false;
        const keycodeKeysyms = {
            8:   [0xFF08], // backspace
            9:   [0xFF09], // tab
            13:  [0xFF0D], // enter
            16:  [0xFFE1, 0xFFE1, 0xFFE2], // shift
            17:  [0xFFE3, 0xFFE3, 0xFFE4], // ctrl
            18:  [0xFFE9, 0xFFE9, 0xFE03], // alt
            19:  [0xFF13], // pause/break
            20:  [0xFFE5], // caps lock
            27:  [0xFF1B], // escape
            32:  [0x0020], // space
            33:  [0xFF55], // page up
            34:  [0xFF56], // page down
            35:  [0xFF57], // end
            36:  [0xFF50], // home
            37:  [0xFF51], // left arrow
            38:  [0xFF52], // up arrow
            39:  [0xFF53], // right arrow
            40:  [0xFF54], // down arrow
            45:  [0xFF63], // insert
            46:  [0xFFFF], // delete
            91:  [0xFFEB], // left window key (hyper_l)
            92:  [0xFF67], // right window key (menu key?)
            93:  null,     // select key
            112: [0xFFBE], // f1
            113: [0xFFBF], // f2
            114: [0xFFC0], // f3
            115: [0xFFC1], // f4
            116: [0xFFC2], // f5
            117: [0xFFC3], // f6
            118: [0xFFC4], // f7
            119: [0xFFC5], // f8
            120: [0xFFC6], // f9
            121: [0xFFC7], // f10
            122: [0xFFC8], // f11
            123: [0xFFC9], // f12
            144: [0xFF7F], // num lock
            145: [0xFF14], // scroll lock
            173: [45], // - key
            191: [47], // / key
            225: [0xFE03]  // altgraph (iso_level3_shift)
        };
        let onkb = (press, e) => {
            cancelEvent(e);
            if (e.repeat) return;
            let keycode = e.keyCode;
            if (keycode == 16) {
                isShiftDown = (press == '1');
            }
            if (keycodeKeysyms.hasOwnProperty(keycode)) keycode = keycodeKeysyms[keycode][e.location] || keycodeKeysyms[keycode][0];
            else if (!isShiftDown && keycode >= 65 && keycode <= 90) keycode = keycode | 0b00100000; // make letter non caps (ascii) if its A, Z or in between
            console.log('key ', keycode);
            currentConn.sendGuac(['key', keycode.toString(), press]);
        }
        this.canvas.onkeydown = e => onkb('1', e);
        this.canvas.onkeyup = e => onkb('0', e);
    }
    setSize(x, y) {
        this.size.x = parseInt(x);
        this.size.y = parseInt(y);
        this.canvas.width = parseInt(x);
        this.canvas.height = parseInt(y);
    }
    drawPng(png, x, y) {
        let img = new Image();
        img.onload = () => this.context.drawImage(img, parseInt(x), parseInt(y));
        img.src = 'data:image/png;base64,' + png;
    }
    handleMsg(msg) {
        if (msg[0] == 'size' && msg[1] == '0') this.setSize(msg[2], msg[3]);
        else if (msg[0] == 'png' && msg[2] == '0') this.drawPng(msg[5], msg[3], msg[4]);
    }
}

class VMVoting {
    constructor() {

    }
    handleMsg(msg) {

    }
}

class VMUserList {
    constructor() {

    }
    handleMsg(msg) {

    }
}

class VMChat {
    constructor() {

    }
    handleMsg(msg) {

    }
}

function takeTurn() {
    currentConn.sendGuac(['turn']);
}
function endTurn() {
    currentConn.sendGuac(['turn', '0']);
}
function toggleKeyboard() {
    alert('Sorry, visual keyboard is not implemented yet');
}
function voteYes() {
    currentConn.sendGuac(['vote', '1']);
}
function voteNo() {
    currentConn.sendGuac(['vote', '0']);
}

async function enterVM(ip, name, title) {
    $('#vm-list').hide();
    $('#vm-view').show();
    $('#navbar-back').show();
    $('#loading').show();
    let display = new VMDisplay();
    let voting = new VMVoting();
    let userList = new VMUserList();
    let chat = new VMChat();
    currentConn = new VMWebsocket(ip, {
        onOpen: () => {
            currentConn.sendGuac(['rename', localStorage.getItem('username')]);
            currentConn.sendGuac(['connect', name]);
            $('#loading').hide();
        },
        onMessage: msg => {
            if (msg[0] == 'nop') {
                currentConn.sendGuac(['nop']);
            } else if (msg[0] == 'rename' && msg[1] == '0') {
                currentUsername = msg[3];
                $('#chat-username').text(msg[3]);
            } else {
                display.handleMsg(msg);
                voting.handleMsg(msg);
                userList.handleMsg(msg);
                chat.handleMsg(msg);
            }
        }
    }, true);
}

function exitVM() {
    $('#navbar-back').hide();
    $('#vm-view').hide();
    $('#loading').show();
    currentConn.disconnect();
    currentConn = null;
    refreshVMList();
    $('#vm-list').show();
    $('#loading').hide();
}

function refreshVMList() {
    $('#vm-list').empty();
    loadVMList();
}

function showVM(imageData, title, onClick) {
    $('<span>')
        .addClass('vm-list-entry')
        .append(
            $('<img>').prop('src', 'data:image/png;base64,'+imageData),
            $('<h4>').html(title)
        )
        .click(onClick)
        .appendTo($('#vm-list'));
}

if (localStorage.getItem('cvmClientUsed') == null) {
    firstTimeInit();
}

function loadVMList() {
    let servers = JSON.parse(localStorage.getItem('servers'));

    for (let i = 0; i < servers.length; i++) {
        let ws = new VMWebsocket(servers[i], {
            onOpen: () => {
                ws.sendGuac(['connect']);
                ws.sendGuac(['list']);
            },
            onMessage: m => {
                if (m[0] == 'nop') {
                    ws.sendGuac(['nop']);
                    return;
                }
                if (m[0] != 'list') return;
                for (let j = 1; j < m.length; j+=3) {
                    let currentVm = {
                        name: m[j],
                        title: m[j+1],
                        image: m[j+2]
                    };
                    showVM(currentVm.image, currentVm.title, () => enterVM(servers[i], currentVm.name, currentVm.title))
                }
            }
        }, false);
    }
}

loadVMList();

$('#loading').hide();

if (window.location.protocol == 'https:') {
    makeSimpleModal('https-warning-modal', 'HTTPS Warning', 'Since this client is currently hosted on Github Pages, it may not access ws:// (insecure websocket). Therefore, you may experience a limited number of VMs. One way to fix this is to git clone/download this repository onto your computer, and open index.html from there.', [
        {
            classes: 'btn-green',
            html: "OK",
            click: () => closeCurrentModal()
        }
    ], true);
    openModal('https-warning-modal');
}
