// =====================================================================
// LIBRITO APP - LOGICA PRINCIPAL DE LA APLICACION
// Escuela Tecnica N° 35 Ing. Eduardo Latzina
// =====================================================================

// Configurar con las credenciales de tu proyecto Supabase
const CONFIG_SUPABASE_URL = "https://dqnusqngkflwaeayusci.supabase.co";
const CONFIG_SUPABASE_KEY = "sb_publishable_zd7gle01RUi__NSjebV59A_5g-Xb8T5";

let supabaseClient = null;
if (window.supabase) {
    supabaseClient = window.supabase.createClient(CONFIG_SUPABASE_URL, CONFIG_SUPABASE_KEY);
}

// Estado de la sesion
let usuarioActivo = null;
let perfilUsuario = null;
let esModoRegistro = false;

document.addEventListener("DOMContentLoaded", () => {
    inicializarApp();
});

async function inicializarApp() {
    if (supabaseClient) {
        await verificarEstadoSesion();
        activarSuscripcionRealtime();
    }
    renderizarCatalogoPremios();
}

// ---------------------------------------------------------------------
// 1. AUTENTICACION Y PERFIL
// ---------------------------------------------------------------------

async function verificarEstadoSesion() {
    const { data } = await supabaseClient.auth.getSession();
    if (data && data.session) {
        usuarioActivo = data.session.user;
        await obtenerPerfil();
    } else {
        actualizarBotonAuth(false);
    }
}

async function obtenerPerfil() {
    if (!usuarioActivo) return;
    const { data } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', usuarioActivo.id)
        .single();

    if (data) {
        perfilUsuario = data;
        actualizarBotonAuth(true);
    }
}

function actualizarBotonAuth(autenticado) {
    const contenedor = document.getElementById("auth-status-container");
    if (autenticado && perfilUsuario) {
        contenedor.innerHTML = `
            <div class="flex items-center gap-2">
                <div class="bg-amber-900/40 px-3 py-1 rounded-full text-xs font-bold border border-amber-400/30 flex items-center gap-1.5">
                    <span class="text-amber-300">⭐</span>
                    <span>${perfilUsuario.puntos_balance || 0} pts</span>
                </div>
                <button onclick="desconectarUsuario()" class="text-amber-200 hover:text-white text-xs">
                    <i class="fa-solid fa-right-from-bracket"></i>
                </button>
            </div>
        `;
    } else {
        contenedor.innerHTML = `
            <button onclick="mostrarModalAuth()" class="bg-amber-900/40 hover:bg-amber-900/60 px-3 py-1.5 rounded-full text-xs font-semibold border border-amber-400/30 transition">
                <i class="fa-solid fa-user-lock mr-1"></i> Ingresar
            </button>
        `;
    }
}

async function ejecutarAuth(event) {
    event.preventDefault();
    const email = document.getElementById("auth-email").value;
    const pass = document.getElementById("auth-password").value;

    if (esModoRegistro) {
        const nombre = document.getElementById("auth-nombre").value;
        const consent = document.getElementById("auth-consentimiento").checked;

        if (!consent) {
            alert("Es obligatorio el consentimiento parental para utilizar la app escolar.");
            return;
        }

        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: pass
        });

        if (error) {
            alert("Error en registro: " + error.message);
        } else if (data && data.user) {
            await supabaseClient.from('profiles').insert([{
                id: data.user.id,
                email: email,
                nombre_completo: nombre,
                consentimiento_parental: consent,
                puntos_balance: 0
            }]);
            alert("¡Registro exitoso! Te enviamos un correo: por favor, andá a tu Gmail para confirmar tu cuenta antes de ingresar.");
            cerrarModalAuth();
            verificarEstadoSesion();
        }
    } else {
        const { error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: pass
        });

        if (error) {
            alert("Error al ingresar: " + error.message);
        } else {
            cerrarModalAuth();
            verificarEstadoSesion();
        }
    }
}

async function desconectarUsuario() {
    if (supabaseClient) await supabaseClient.auth.signOut();
    usuarioActivo = null;
    perfilUsuario = null;
    actualizarBotonAuth(false);
}

// ---------------------------------------------------------------------
// 2. TUTORIAS Y SOLICITUDES
// ---------------------------------------------------------------------

async function crearSolicitud(event) {
    event.preventDefault();
    if (!usuarioActivo) {
        alert("Inicia sesion para solicitar ayuda.");
        mostrarModalAuth();
        return;
    }

    const mat = document.getElementById("sel-materia").value;
    const tm = document.getElementById("ipt-tema").value;
    const lug = document.getElementById("ipt-lugar").value;

    const { error } = await supabaseClient.from('tutorias').insert([{
        solicitante_id: usuarioActivo.id,
        materia: mat,
        tema: tm,
        ubicacion_aula: lug,
        estado: 'pendiente'
    }]);

    if (error) {
        alert("Error al crear solicitud: " + error.message);
    } else {
        alert("Solicitud publicada exitosamente.");
        document.getElementById("form-solicitud").reset();
        cargarListaMisSolicitudes();
    }
}

async function aceptarTutoria(idTutoria) {
    if (!usuarioActivo) {
        alert("Inicia sesion como tutor.");
        mostrarModalAuth();
        return;
    }

    const { error } = await supabaseClient.from('tutorias')
        .update({
            tutor_id: usuarioActivo.id,
            estado: 'en_curso',
            fecha_inicio: new Date().toISOString()
        })
        .eq('id', idTutoria);

    if (error) {
        alert("Error al aceptar: " + error.message);
    } else {
        alert("Tutoria aceptada. Coordinar encuentro.");
        cargarFeedTutorias();
    }
}

// ---------------------------------------------------------------------
// 3. REALTIME FEED
// ---------------------------------------------------------------------

function activarSuscripcionRealtime() {
    supabaseClient
        .channel('cambios-tutorias')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tutorias' }, () => {
            cargarFeedTutorias();
            cargarListaMisSolicitudes();
        })
        .subscribe();

    cargarFeedTutorias();
}

async function cargarFeedTutorias() {
    const elem = document.getElementById("feed-tutorias");
    if (!supabaseClient) {
        elem.innerHTML = `<p class="text-xs text-slate-400 italic">Modo offline / Demo activo.</p>`;
        return;
    }

    const { data } = await supabaseClient
        .from('tutorias')
        .select('*')
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false });

    if (!data || data.length === 0) {
        elem.innerHTML = `<p class="text-xs text-slate-400 italic">No hay solicitudes pendientes en este momento.</p>`;
        return;
    }

    elem.innerHTML = data.map(item => `
        <div class="bg-amber-50/60 border border-amber-200 p-3 rounded-xl flex justify-between items-center text-xs">
            <div>
                <span class="font-bold text-amber-900 block">${item.materia}</span>
                <span class="text-slate-600 font-medium">Tema: ${item.tema}</span>
                <span class="text-[10px] text-slate-400 block mt-0.5">📍 ${item.ubicacion_aula}</span>
            </div>
            <button onclick="aceptarTutoria('${item.id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg font-bold shadow-sm transition">
                Aceptar (+50 pts)
            </button>
        </div>
    `).join('');
}

async function cargarListaMisSolicitudes() {
    const elem = document.getElementById("lista-mis-solicitudes");
    if (!usuarioActivo || !supabaseClient) {
        elem.innerHTML = `Ingresa para ver tus solicitudes.`;
        return;
    }

    const { data } = await supabaseClient
        .from('tutorias')
        .select('*')
        .eq('solicitante_id', usuarioActivo.id);

    if (!data || data.length === 0) {
        elem.innerHTML = `No tienes solicitudes activas.`;
        return;
    }

    elem.innerHTML = data.map(s => `
        <div class="p-2 bg-slate-50 border rounded-lg flex justify-between items-center">
            <div>
                <strong class="text-slate-800">${s.materia}</strong> - ${s.tema}
            </div>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${s.estado === 'pendiente' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">
                ${s.estado.toUpperCase()}
            </span>
        </div>
    `).join('');
}

// ---------------------------------------------------------------------
// 4. CATALOGO Y CANJES POR QR
// ---------------------------------------------------------------------

function renderizarCatalogoPremios() {
    const elem = document.getElementById("grid-recompensas");
    const premios = [
        { id: 1, comercio: 'Libreria Tesis', titulo: '2x1 en Fotocopias / Planos A3', costo: 50, icono: '📑' },
        { id: 2, comercio: 'McDonalds', titulo: 'Cono de Helado Gratis', costo: 100, icono: '🍦' },
        { id: 3, comercio: 'Burger 54', titulo: '2x1 en Combos de Almuerzo', costo: 150, icono: '🍔' },
        { id: 4, comercio: 'Mostaza', titulo: 'Papas Grandes Gratis', costo: 80, icono: '🍟' },
        { id: 5, comercio: 'Grido', titulo: 'Palito / Cono Helado Gratis', costo: 70, icono: '🍨' }
    ];

    elem.innerHTML = premios.map(p => `
        <div class="bg-slate-50 border border-slate-200 p-3 rounded-2xl flex justify-between items-center text-xs">
            <div class="flex items-center gap-3">
                <div class="text-2xl">${p.icono}</div>
                <div>
                    <span class="text-[10px] uppercase tracking-wider font-extrabold text-amber-800 block">${p.comercio}</span>
                    <strong class="text-slate-800 font-bold block">${p.titulo}</strong>
                    <span class="text-amber-600 font-bold text-[11px]">⭐ ${p.costo} Puntos</span>
                </div>
            </div>
            <button onclick="generarQRCanje('${p.id}', '${p.costo}')" class="bg-amber-700 hover:bg-amber-800 text-white px-3 py-1.5 rounded-xl font-bold shadow-sm transition">
                Canjear QR
            </button>
        </div>
    `).join('');
}

function generarQRCanje(idPremio, costo) {
    if (!usuarioActivo) {
        alert("Inicia sesion para canjear tu premio.");
        mostrarModalAuth();
        return;
    }

    if (perfilUsuario && perfilUsuario.puntos_balance < costo) {
        alert("Puntos insuficientes.");
        return;
    }

    const codigo = "LIB-" + Math.random().toString(36).substring(2, 10).toUpperCase();

    document.getElementById("qrcode-container").innerHTML = "";
    new QRCode(document.getElementById("qrcode-container"), {
        text: codigo,
        width: 140,
        height: 140
    });

    document.getElementById("qr-code-text").innerText = codigo;
    document.getElementById("modal-qr").classList.remove("hidden");
}

function cerrarModalQR() {
    document.getElementById("modal-qr").classList.add("hidden");
}

// ---------------------------------------------------------------------
// 5. MODALES Y PESTAÑAS
// ---------------------------------------------------------------------

function cambiarTab(tab) {
    ['pedir', 'ensenar', 'catalogo'].forEach(t => {
        document.getElementById(`sec-${t}`).classList.add('hidden');
        document.getElementById(`tab-${t}`).className = "py-2 rounded-lg text-amber-900/70 hover:text-amber-950 transition";
    });

    document.getElementById(`sec-${tab}`).classList.remove('hidden');
    document.getElementById(`tab-${tab}`).className = "py-2 rounded-lg bg-white shadow-sm text-amber-800 transition font-bold";
}

function mostrarModalAuth() {
    document.getElementById("modal-auth").classList.remove("hidden");
}

function cerrarModalAuth() {
    document.getElementById("modal-auth").classList.add("hidden");
}

function toggleModoAuth() {
    esModoRegistro = !esModoRegistro;
    document.getElementById("auth-title").innerText = esModoRegistro ? "Crear Cuenta" : "Ingresar a Librito";
    document.getElementById("campo-nombre").classList.toggle("hidden", !esModoRegistro);
    document.getElementById("campo-consentimiento").classList.toggle("hidden", !esModoRegistro);
    document.getElementById("btn-auth-submit").innerText = esModoRegistro ? "Registrarse" : "Iniciar Sesion";
    document.getElementById("btn-toggle-auth").innerText = esModoRegistro ? "¿Ya tienes cuenta? Ingresa" : "¿No tienes cuenta? Registrate";
}
