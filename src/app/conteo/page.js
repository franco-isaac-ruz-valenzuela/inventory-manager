'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { db } from '../../lib/firebase';
import {
  collection,
  onSnapshot,
  writeBatch,
  doc,
  serverTimestamp,
  addDoc,
  setDoc,
} from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { logAction } from '../../lib/auditLog';
import { sendNotification } from '../../lib/notifications';
import { generateDiffReport, downloadWorkbook } from '../../lib/excelUtils';
import {
  getProductMainType,
  detectProductColor,
} from '../../lib/stockRules';
import BarcodeScanner from '../../components/BarcodeScanner';

const CATEGORY_COLORS = {
  'ONDULADAS': { bg: 'rgba(0, 212, 255, 0.12)', color: '#00d4ff', icon: 'bi-water' },
  'ALVEOLAR': { bg: 'rgba(16, 185, 129, 0.12)', color: '#10b981', icon: 'bi-grid-3x3' },
  'PERFILES': { bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', icon: 'bi-rulers' },
  'INDUSTRIAL': { bg: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', icon: 'bi-building' },
  'PACK': { bg: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6', icon: 'bi-box2' },
  'COMPACTO': { bg: 'rgba(236, 72, 153, 0.12)', color: '#ec4899', icon: 'bi-square' },
  'ACCESORIOS': { bg: 'rgba(168, 85, 247, 0.12)', color: '#a855f7', icon: 'bi-wrench' },
  'ROLLO': { bg: 'rgba(20, 184, 166, 0.12)', color: '#14b8a6', icon: 'bi-arrow-repeat' },
  'MATERIAS PRIMAS': { bg: 'rgba(251, 146, 60, 0.12)', color: '#fb923c', icon: 'bi-moisture' },
  'OTROS': { bg: 'rgba(148, 163, 184, 0.12)', color: '#94a3b8', icon: 'bi-three-dots' },
  'PLANCHAS METALICAS': { bg: 'rgba(100, 116, 139, 0.12)', color: '#64748b', icon: 'bi-subtract' },
  'PINTURAS Y ADHESIVOS': { bg: 'rgba(217, 70, 239, 0.12)', color: '#d946ef', icon: 'bi-paint-bucket' },
  'CANALETAS Y ACCESORIOS': { bg: 'rgba(34, 197, 94, 0.12)', color: '#22c55e', icon: 'bi-funnel' },
  'SIN CATEGORÍA': { bg: 'rgba(255, 255, 255, 0.06)', color: '#94a3b8', icon: 'bi-question-circle' },
};

const getCategoryStyle = (cat) => {
  const upper = (cat || '').toUpperCase();
  return CATEGORY_COLORS[upper] || CATEGORY_COLORS['SIN CATEGORÍA'];
};

const DRAFT_STORAGE_KEY = 'leker_physical_audit_v1';

export default function ConteoFisicoPage() {
  const { currentUser, canEdit } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Tab activo: 'conteo' (registro) | 'analisis' (inconsistencias)
  const [activeTab, setActiveTab] = useState('conteo');

  // Mapa de conteo físico: { [productId]: number } (por defecto 0)
  const [countedMap, setCountedMap] = useState({});
  // Mapa de items tocados/confirmados por el usuario
  const [touchedMap, setTouchedMap] = useState({});

  // Sincronización en la nube multi-dispositivo en Firestore
  const [cloudSynced, setCloudSynced] = useState(false);
  const [cloudLastUpdated, setCloudLastUpdated] = useState(null);
  const [cloudUpdatedBy, setCloudUpdatedBy] = useState('');
  const [updatedByMap, setUpdatedByMap] = useState({});

  // Nombre de la sesión de conteo
  const [sessionName, setSessionName] = useState(() => {
    const today = new Date().toLocaleDateString('es-CL', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
    return `Conteo Físico Bodega — ${today}`;
  });

  // Filtros
  const [search, setSearch] = useState('');
  const [selectedMainType, setSelectedMainType] = useState('all');
  const [selectedColor, setSelectedColor] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all'); // all | diff | faltante | sobrante | exacto | contados | pendientes

  // Scanner modal
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [lastScannedMsg, setLastScannedMsg] = useState(null);

  // Modales
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [applying, setApplying] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  const currentMonthKey = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const [monthAlert, setMonthAlert] = useState(null);

  // 1. Cargar productos desde Firestore (tiempo real)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'products'), (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...docSnap.data() });
      });
      // Orden alfabético por SKU
      items.sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));
      setProducts(items);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // 2. Suscripción en tiempo real a la sesión de conteo activa en Firestore (Multi-dispositivo)
  useEffect(() => {
    const auditDocRef = doc(db, 'active_physical_audit', 'current');
    const unsub = onSnapshot(auditDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const incomingCounts = data.counts || {};
        const incomingSessionName = data.sessionName;
        const incomingMonth = data.monthKey;

        // Si el conteo en la nube pertenece a un mes anterior
        if (incomingMonth && incomingMonth !== currentMonthKey) {
          setMonthAlert({
            previousMonthName: incomingSessionName || 'Mes anterior',
            draftData: data,
          });
        }

        setCountedMap(incomingCounts);
        if (data.updatedByMap) setUpdatedByMap(data.updatedByMap);
        if (incomingSessionName) setSessionName(incomingSessionName);
        if (data.lastUpdated) {
          setCloudLastUpdated(data.lastUpdated.toDate ? data.lastUpdated.toDate() : new Date());
        }
        if (data.lastUpdatedBy) setCloudUpdatedBy(data.lastUpdatedBy);
        setCloudSynced(true);
      } else {
        // Inicializar documento en la nube si aún no existe
        setDoc(auditDocRef, {
          sessionName,
          monthKey: currentMonthKey,
          status: 'in_progress',
          counts: {},
          updatedByMap: {},
          createdAt: serverTimestamp(),
          lastUpdated: serverTimestamp(),
          lastUpdatedBy: currentUser?.displayName || currentUser?.email || 'Sistema',
        }, { merge: true }).catch(console.error);
        setCloudSynced(true);
      }
    }, (err) => {
      console.error('Error sincronizando conteo en vivo:', err);
      setCloudSynced(false);
    });

    return () => unsub();
  }, [currentMonthKey, currentUser]);

  // 3. Respaldo local en localStorage como contingencia
  useEffect(() => {
    if (loading || products.length === 0) return;
    try {
      const payload = {
        sessionName,
        monthKey: currentMonthKey,
        countedMap,
        touchedMap,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.error('Error guardando borrador local:', err);
    }
  }, [countedMap, touchedMap, sessionName, loading, products.length, currentMonthKey]);

  // Función para sincronizar un producto en la nube atómicamente
  const syncCountToCloud = useCallback(async (productId, num) => {
    try {
      const auditDocRef = doc(db, 'active_physical_audit', 'current');
      const uName = currentUser?.displayName || currentUser?.email || 'Usuario';
      const timeStr = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

      // Usar dot-notation en Firestore para modificar únicamente este producto sin sobreescribir otros
      await setDoc(auditDocRef, {
        sessionName,
        monthKey: currentMonthKey,
        status: 'in_progress',
        [`counts.${productId}`]: num,
        [`updatedByMap.${productId}`]: {
          userName: uName,
          time: timeStr,
        },
        lastUpdated: serverTimestamp(),
        lastUpdatedBy: uName,
      }, { merge: true });
    } catch (err) {
      console.error('Error enviando conteo a la nube:', err);
    }
  }, [sessionName, currentMonthKey, currentUser]);

  // Actualizar conteo de un producto específico (UI optimista + Sync Nube)
  const setCountForProduct = useCallback((productId, value) => {
    const num = Math.max(0, parseInt(value, 10) || 0);
    setCountedMap((prev) => ({ ...prev, [productId]: num }));
    setTouchedMap((prev) => ({ ...prev, [productId]: true }));
    syncCountToCloud(productId, num);
  }, [syncCountToCloud]);

  // Incrementar o decrementar conteo (UI optimista + Sync Nube)
  const adjustCount = useCallback((productId, delta) => {
    let nextNum = 0;
    setCountedMap((prev) => {
      const current = Number(prev[productId]) || 0;
      nextNum = Math.max(0, current + delta);
      return { ...prev, [productId]: nextNum };
    });
    setTouchedMap((prev) => ({ ...prev, [productId]: true }));
    syncCountToCloud(productId, nextNum);
  }, [syncCountToCloud]);

  // Marcar conteo igual al stock del sistema (teórico)
  const setEqualToSystem = useCallback((product) => {
    const sys = Number(product.quantity) || 0;
    setCountForProduct(product.id, Math.max(0, sys));
  }, [setCountForProduct]);

  // Poner en 0
  const setToZero = useCallback((productId) => {
    setCountForProduct(productId, 0);
  }, [setCountForProduct]);

  // Manejo de lectura de escáner (cámara o código de barras)
  const handleBarcodeScan = useCallback((code) => {
    if (!code) return;
    const clean = code.trim().toLowerCase();
    const match = products.find((p) => (p.sku || '').toLowerCase() === clean);

    if (match) {
      adjustCount(match.id, 1);
      setLastScannedMsg({
        success: true,
        text: `+1 a ${match.sku} (${match.name}) — Conteo actual: ${(countedMap[match.id] || 0) + 1} uds`,
      });
    } else {
      setLastScannedMsg({
        success: false,
        text: `Código "${code}" no encontrado en el catálogo de productos.`,
      });
    }
  }, [products, adjustCount, countedMap]);

  // Reiniciar todo a 0 (en local y en la nube para todos los dispositivos)
  const handleResetAll = async () => {
    setCountedMap({});
    setTouchedMap({});
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      const auditDocRef = doc(db, 'active_physical_audit', 'current');
      const uName = currentUser?.displayName || currentUser?.email || 'Usuario';
      await setDoc(auditDocRef, {
        sessionName: `Conteo Físico Bodega — ${new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })}`,
        monthKey: currentMonthKey,
        status: 'in_progress',
        counts: {},
        updatedByMap: {},
        lastUpdated: serverTimestamp(),
        lastUpdatedBy: uName,
      });
    } catch (e) {
      console.error('Error reseteando en la nube:', e);
    }
    setShowResetModal(false);
    setFeedbackMsg('Todo el conteo físico ha sido reiniciado a 0 en todos los dispositivos.');
    setTimeout(() => setFeedbackMsg(''), 5000);
  };

  // Copiar todo el sistema a conteo (sincroniza en la nube)
  const handleCopyAllSystem = async () => {
    if (!window.confirm('¿Copiar todo el stock del sistema al conteo físico? Luego podrás ajustar solo los que tengan diferencias.')) return;
    const newMap = {};
    const newTouch = {};
    products.forEach((p) => {
      newMap[p.id] = Math.max(0, Number(p.quantity) || 0);
      newTouch[p.id] = true;
    });
    setCountedMap(newMap);
    setTouchedMap(newTouch);
    try {
      const auditDocRef = doc(db, 'active_physical_audit', 'current');
      const uName = currentUser?.displayName || currentUser?.email || 'Usuario';
      await setDoc(auditDocRef, {
        sessionName,
        monthKey: currentMonthKey,
        counts: newMap,
        lastUpdated: serverTimestamp(),
        lastUpdatedBy: uName,
      }, { merge: true });
    } catch (e) {
      console.error(e);
    }
    setFeedbackMsg('Se copiaron las cantidades teóricas a la nube para todos los dispositivos.');
    setTimeout(() => setFeedbackMsg(''), 5000);
  };

  // --------------------------------------------------------------------------
  // CÁLCULO DE DIFERENCIAS E INCONSISTENCIAS (TEÓRICO VS FÍSICO)
  // --------------------------------------------------------------------------
  const {
    itemsWithDiff,
    metrics,
    familySummary,
  } = useMemo(() => {
    let totalItems = products.length;
    let exactMatches = 0;
    let totalDifferences = 0;
    let faltantesCount = 0;
    let sobrantesCount = 0;
    let faltantesUnits = 0;
    let sobrantesUnits = 0;
    let netUnitsDiff = 0;
    let countedItemsCount = 0;
    let pendingZeroCount = 0;

    const families = {
      planchas: { label: 'Planchas', total: 0, diffs: 0, netDiff: 0 },
      perfiles: { label: 'Perfiles', total: 0, diffs: 0, netDiff: 0 },
      accesorios: { label: 'Accesorios', total: 0, diffs: 0, netDiff: 0 },
      pinturas: { label: 'Pinturas y Adhesivos', total: 0, diffs: 0, netDiff: 0 },
      otros: { label: 'Otros', total: 0, diffs: 0, netDiff: 0 },
    };

    const calculatedItems = products.map((p) => {
      const systemQty = Number(p.quantity) || 0;
      const countedQty = Number(countedMap[p.id]) || 0;
      const isTouched = !!touchedMap[p.id];
      const diff = countedQty - systemQty; // Físico - Teórico
      const mainType = getProductMainType(p);
      const color = detectProductColor(p);

      if (countedQty > 0 || isTouched) {
        countedItemsCount++;
      } else {
        pendingZeroCount++;
      }

      if (diff === 0) {
        exactMatches++;
      } else {
        totalDifferences++;
        if (diff < 0) {
          faltantesCount++;
          faltantesUnits += Math.abs(diff);
        } else {
          sobrantesCount++;
          sobrantesUnits += diff;
        }
      }
      netUnitsDiff += diff;

      if (families[mainType]) {
        families[mainType].total++;
        if (diff !== 0) {
          families[mainType].diffs++;
          families[mainType].netDiff += diff;
        }
      }

      return {
        ...p,
        systemQty,
        countedQty,
        diff,
        isTouched,
        mainType,
        color,
        status: diff === 0 ? 'exacto' : diff > 0 ? 'sobrante' : 'faltante',
      };
    });

    const accuracyRate = totalItems > 0
      ? ((exactMatches / totalItems) * 100).toFixed(1)
      : '100.0';

    return {
      itemsWithDiff: calculatedItems,
      metrics: {
        total: totalItems,
        exactMatches,
        totalDifferences,
        faltantesCount,
        sobrantesCount,
        faltantesUnits,
        sobrantesUnits,
        netUnitsDiff,
        countedItemsCount,
        pendingZeroCount,
        accuracyRate,
      },
      familySummary: Object.values(families),
    };
  }, [products, countedMap, touchedMap]);

  // --------------------------------------------------------------------------
  // FILTRADO DINÁMICO DE PRODUCTOS PARA LA VISTA
  // --------------------------------------------------------------------------
  const filteredItems = useMemo(() => {
    return itemsWithDiff.filter((item) => {
      // 1. Buscador
      if (search.trim()) {
        const q = search.toLowerCase();
        const skuMatch = (item.sku || '').toLowerCase().includes(q);
        const nameMatch = (item.name || '').toLowerCase().includes(q);
        const catMatch = (item.category || '').toLowerCase().includes(q);
        if (!skuMatch && !nameMatch && !catMatch) return false;
      }

      // 2. Familia Principal
      if (selectedMainType !== 'all') {
        if (item.mainType !== selectedMainType) return false;
      }

      // 3. Tono (solo si planchas está seleccionado o tono específico)
      if (selectedColor !== 'all') {
        if (item.color !== selectedColor) return false;
      }

      // 4. Subcategoría / Modelo
      if (selectedCategory !== 'all') {
        if ((item.category || '').toUpperCase() !== selectedCategory.toUpperCase()) return false;
      }

      // 5. Filtro de Estado de Conteo
      if (statusFilter === 'diff') {
        if (item.diff === 0) return false;
      } else if (statusFilter === 'faltante') {
        if (item.diff >= 0) return false;
      } else if (statusFilter === 'sobrante') {
        if (item.diff <= 0) return false;
      } else if (statusFilter === 'exacto') {
        if (item.diff !== 0) return false;
      } else if (statusFilter === 'contados') {
        if (item.countedQty === 0 && !item.isTouched) return false;
      } else if (statusFilter === 'pendientes') {
        if (item.countedQty > 0 || item.isTouched) return false;
      }

      return true;
    });
  }, [itemsWithDiff, search, selectedMainType, selectedColor, selectedCategory, statusFilter]);

  // Contadores de tonos para planchas
  const planchaToneCounts = useMemo(() => {
    const planchas = itemsWithDiff.filter((p) => p.mainType === 'planchas');
    return {
      all: planchas.length,
      clear: planchas.filter((p) => p.color === 'clear').length,
      opal: planchas.filter((p) => p.color === 'opal').length,
      bronce: planchas.filter((p) => p.color === 'bronce').length,
    };
  }, [itemsWithDiff]);

  // Modelos de planchas disponibles
  const planchaModelList = useMemo(() => {
    const planchas = itemsWithDiff.filter((p) => p.mainType === 'planchas');
    const counts = {};
    planchas.forEach((p) => {
      const cat = (p.category || 'SIN CATEGORÍA').toUpperCase();
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [itemsWithDiff]);

  // --------------------------------------------------------------------------
  // EXPORTAR REPORTE A EXCEL
  // --------------------------------------------------------------------------
  const handleExportExcel = async () => {
    try {
      const diffRows = itemsWithDiff
        .filter((d) => d.diff !== 0)
        .map((d) => ({
          sku: d.sku,
          name: d.name,
          previousQty: d.systemQty,
          currentQty: d.countedQty,
          diff: d.diff,
          status: d.diff > 0 ? 'nuevo' : 'eliminado',
        }));

      const comparisonResult = {
        summary: {
          total: metrics.total,
          totalDifferences: metrics.totalDifferences,
          added: metrics.sobrantesCount,
          removed: metrics.faltantesCount,
          changed: metrics.totalDifferences,
          unchanged: metrics.exactMatches,
        },
        differences: diffRows,
      };

      const wb = generateDiffReport(comparisonResult, sessionName);
      const filename = `auditoria_fisica_${new Date().toISOString().slice(0, 10)}.xlsx`;
      downloadWorkbook(wb, filename);

      await logAction('reporte_descargado', currentUser, {
        description: `Exportó reporte de auditoría física "${sessionName}" con ${metrics.totalDifferences} discrepancias detectadas.`,
      });
    } catch (err) {
      console.error('Error generando Excel:', err);
      alert('Error al generar el archivo Excel: ' + err.message);
    }
  };

  // --------------------------------------------------------------------------
  // GUARDAR SESIÓN DE AUDITORÍA EN FIRESTORE (PARA /reportes)
  // --------------------------------------------------------------------------
  const handleSaveAuditSession = async () => {
    if (savingSession) return;
    setSavingSession(true);

    try {
      const diffRows = itemsWithDiff.map((d) => ({
        sku: d.sku,
        name: d.name,
        category: d.category,
        previousQty: d.systemQty,
        currentQty: d.countedQty,
        diff: d.diff,
        status: d.diff === 0 ? 'sin_cambio' : d.diff > 0 ? 'nuevo' : 'eliminado',
      }));

      await addDoc(collection(db, 'inventory_sessions'), {
        name: sessionName,
        createdAt: serverTimestamp(),
        createdBy: currentUser?.uid || 'anon',
        createdByName: currentUser?.displayName || currentUser?.email || 'Usuario',
        status: 'completed',
        auditType: 'conteo_fisico_bodega',
        previousFile: 'Stock Teórico (Sistema)',
        currentFile: 'Conteo Físico Real',
        summary: {
          total: metrics.total,
          totalDifferences: metrics.totalDifferences,
          added: metrics.sobrantesCount,
          removed: metrics.faltantesCount,
          changed: metrics.totalDifferences,
          unchanged: metrics.exactMatches,
          accuracyRate: metrics.accuracyRate,
          netUnitsDiff: metrics.netUnitsDiff,
        },
        differences: diffRows.filter((d) => d.diff !== 0),
      });

      await logAction('comparacion_realizada', currentUser, {
        description: `Guardó sesión de auditoría física "${sessionName}". Evaluó ${metrics.total} productos con ${metrics.totalDifferences} inconsistencias.`,
      });

      await sendNotification(
        'info',
        `${currentUser?.displayName || currentUser?.email} guardó la auditoría física "${sessionName}" (${metrics.totalDifferences} discrepancias)`,
        currentUser
      );

      const shouldReset = window.confirm(
        '¡Sesión de auditoría guardada con éxito en los Reportes!\n\n¿Deseas dar por finalizado este conteo y reiniciar todo a 0 para el nuevo ciclo de toma de inventario?'
      );

      if (shouldReset) {
        handleResetAll();
      } else {
        setFeedbackMsg('Sesión de auditoría guardada con éxito en los Reportes.');
        setTimeout(() => setFeedbackMsg(''), 6000);
      }
    } catch (err) {
      console.error('Error guardando auditoría:', err);
      alert('Error al guardar sesión: ' + err.message);
    }

    setSavingSession(false);
  };

  // --------------------------------------------------------------------------
  // APLICAR CONTEO AL INVENTARIO REAL (SOLO FRANCO Y M.SILVA)
  // --------------------------------------------------------------------------
  const handleApplyCountToMaster = async () => {
    if (!canEdit) {
      alert('Solo Franco y M.silva tienen permisos para conciliar y aplicar el conteo al inventario real.');
      return;
    }

    const itemsToUpdate = itemsWithDiff.filter((d) => d.diff !== 0);
    if (itemsToUpdate.length === 0) {
      alert('No hay productos con diferencias que requieran actualización.');
      setShowApplyModal(false);
      return;
    }

    setApplying(true);
    try {
      // Usar writeBatch para atomicidad
      const batch = writeBatch(db);

      itemsToUpdate.forEach((d) => {
        const docRef = doc(db, 'products', d.id);
        batch.update(docRef, {
          quantity: d.countedQty,
          lastUpdated: serverTimestamp(),
          updatedBy: currentUser?.uid || 'anon',
          lastAuditSession: sessionName,
        });
      });

      await batch.commit();

      // Guardar también la sesión en historial
      await addDoc(collection(db, 'inventory_sessions'), {
        name: `Conciliación: ${sessionName}`,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName || currentUser.email,
        status: 'applied_to_inventory',
        auditType: 'conciliacion_directa',
        previousFile: 'Inventario Anterior',
        currentFile: 'Ajustado a Conteo Físico',
        summary: {
          total: metrics.total,
          totalDifferences: itemsToUpdate.length,
          added: metrics.sobrantesCount,
          removed: metrics.faltantesCount,
          changed: itemsToUpdate.length,
          unchanged: metrics.exactMatches,
        },
        differences: itemsToUpdate.map((d) => ({
          sku: d.sku,
          name: d.name,
          previousQty: d.systemQty,
          currentQty: d.countedQty,
          diff: d.diff,
          status: d.diff > 0 ? 'nuevo' : 'eliminado',
        })),
      });

      await logAction('conciliacion_inventario', currentUser, {
        description: `Concilió inventario físico: Actualizó ${itemsToUpdate.length} productos en la base de datos según el conteo "${sessionName}".`,
      });

      await sendNotification(
        'editado',
        `${currentUser?.displayName || currentUser?.email} aplicó el conteo físico al inventario real (${itemsToUpdate.length} productos actualizados)`,
        currentUser
      );

      setShowApplyModal(false);
      setFeedbackMsg(`¡Éxito! Se actualizaron ${itemsToUpdate.length} productos en el inventario real de Puerto Montt.`);
      setTimeout(() => setFeedbackMsg(''), 7000);
    } catch (err) {
      console.error('Error aplicando conteo:', err);
      alert('Error al aplicar el conteo en Firestore: ' + err.message);
    }
    setApplying(false);
  };

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '16px' }}>
          <div className="spinner" style={{ width: 44, height: 44, borderWidth: 3 }} />
          <div className="text-secondary fw-semibold">Cargando catálogo para conteo físico...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
        <div>
          <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
            <h1 className="page-title mb-0">Conteo Físico & Auditoría</h1>
            <span
              className="badge"
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                fontSize: '11px',
                padding: '4px 8px',
              }}
            >
              <i className="bi bi-shield-check me-1"></i>
              Inventario real intacto
            </span>

            <span
              className="badge d-inline-flex align-items-center gap-1"
              style={{
                background: cloudSynced ? 'rgba(0, 212, 255, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                color: cloudSynced ? '#00d4ff' : '#f59e0b',
                border: `1px solid ${cloudSynced ? 'rgba(0, 212, 255, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                fontSize: '11px',
                padding: '4px 8px',
              }}
              title={cloudLastUpdated ? `Última sincronización por ${cloudUpdatedBy || 'Equipo'} a las ${cloudLastUpdated.toLocaleTimeString('es-CL')}` : 'Sincronización en vivo activada'}
            >
              <i className={`bi ${cloudSynced ? 'bi-broadcast text-success' : 'bi-cloud-slash'}`}></i>
              <span>{cloudSynced ? 'En la nube (Multi-dispositivo en vivo)' : 'Conectando a la nube...'}</span>
            </span>
          </div>
          <p className="page-description mb-0">
            Espacio independiente para toma física en bodega. Todo inicia en 0 para contar sin alterar el stock real.
          </p>
        </div>

        {/* Acciones principales del encabezado */}
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn-outline-info text-info btn-sm d-inline-flex align-items-center gap-2"
            onClick={() => setShowScannerModal(true)}
            title="Escanear con cámara o pistola de código de barras"
          >
            <i className="bi bi-upc-scan"></i>
            <span>Escáner Rápido</span>
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm d-inline-flex align-items-center gap-2"
            onClick={handleExportExcel}
            title="Descargar reporte comparativo en Excel"
          >
            <i className="bi bi-file-earmark-excel-fill"></i>
            <span>Exportar Excel</span>
          </button>

          <button
            type="button"
            className="btn btn-success btn-sm d-inline-flex align-items-center gap-2"
            onClick={handleSaveAuditSession}
            disabled={savingSession}
            title="Guardar sesión para consultar en Reportes"
          >
            {savingSession ? (
              <>
                <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                <span>Guardando...</span>
              </>
            ) : (
              <>
                <i className="bi bi-floppy2-fill"></i>
                <span>Guardar Auditoría</span>
              </>
            )}
          </button>

          {canEdit && (
            <button
              type="button"
              className="btn btn-warning text-dark fw-bold btn-sm d-inline-flex align-items-center gap-2"
              onClick={() => setShowApplyModal(true)}
              title="Ajustar el stock real del sistema con los valores de este conteo"
            >
              <i className="bi bi-check2-all"></i>
              <span>Aplicar al Inventario Real</span>
            </button>
          )}
        </div>
      </div>

      {/* Alerta de Nuevo Mes detectado */}
      {monthAlert && (
        <div
          className="alert alert-warning p-3 mb-3 border-0 shadow-sm d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-3"
          style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', borderRadius: 'var(--radius-md)' }}
        >
          <div>
            <div className="fw-bold d-flex align-items-center gap-2 mb-1">
              <i className="bi bi-calendar-event-fill"></i>
              <span>¡Nuevo ciclo mensual detectado!</span>
            </div>
            <div className="small text-light opacity-75">
              Tienes un borrador de conteo del mes anterior ({monthAlert.previousMonthName}). ¿Deseas iniciar el conteo de este nuevo mes todo en 0 o continuar el borrador anterior?
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-shrink-0">
            <button
              type="button"
              className="btn btn-warning text-dark fw-bold btn-sm d-inline-flex align-items-center gap-1"
              onClick={() => {
                setCountedMap({});
                setTouchedMap({});
                setMonthAlert(null);
                setFeedbackMsg('Iniciado nuevo conteo del mes en 0.');
                setTimeout(() => setFeedbackMsg(''), 5000);
              }}
            >
              <i className="bi bi-arrow-counterclockwise"></i>
              <span>Iniciar Mes en 0</span>
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary text-light btn-sm"
              onClick={() => {
                setCountedMap(monthAlert.draftData.countedMap || {});
                setTouchedMap(monthAlert.draftData.touchedMap || {});
                if (monthAlert.draftData.sessionName) setSessionName(monthAlert.draftData.sessionName);
                setMonthAlert(null);
              }}
            >
              Mantener Anterior
            </button>
          </div>
        </div>
      )}

      {/* Banner de feedback / auto-save */}
      {feedbackMsg && (
        <div
          className="alert alert-info d-flex align-items-center justify-content-between p-3 mb-3 border-0 shadow-sm"
          style={{ background: 'rgba(0, 212, 255, 0.12)', color: '#00d4ff', borderRadius: 'var(--radius-md)' }}
        >
          <div className="d-flex align-items-center gap-2">
            <i className="bi bi-info-circle-fill fs-5"></i>
            <span style={{ fontSize: '14px' }}>{feedbackMsg}</span>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-link text-info p-0"
            onClick={() => setFeedbackMsg('')}
          >
            <i className="bi bi-x-lg"></i>
          </button>
        </div>
      )}

      {/* Título de la sesión editable + Herramientas de conteo masivo */}
      <div
        className="card mb-3 p-3 shadow-sm"
        style={{ background: 'rgba(15, 15, 35, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)' }}
      >
        <div className="row g-2 align-items-center">
          <div className="col-12 col-md-6">
            <div className="d-flex align-items-center gap-2">
              <i className="bi bi-pencil text-secondary" style={{ fontSize: '14px' }}></i>
              <input
                type="text"
                className="form-control form-control-sm bg-dark text-light border-secondary"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="Nombre de la sesión de conteo..."
                style={{ fontWeight: 600, fontSize: '14px' }}
                title="Nombre de la sesión (se incluirá en el reporte Excel)"
              />
            </div>
          </div>
          <div className="col-12 col-md-6 d-flex justify-content-start justify-content-md-end gap-2 flex-wrap">
            <button
              type="button"
              className="btn btn-outline-secondary text-light btn-sm d-inline-flex align-items-center gap-1"
              onClick={handleCopyAllSystem}
              title="Copiar las cantidades del sistema a todos los productos"
            >
              <i className="bi bi-copy"></i>
              <span className="d-none d-sm-inline">Copiar Teórico a Todos</span>
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm d-inline-flex align-items-center gap-1"
              onClick={() => setShowResetModal(true)}
              title="Reiniciar todo el conteo físico a 0"
            >
              <i className="bi bi-arrow-counterclockwise"></i>
              <span>Reiniciar a 0</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tarjetas KPI de Estado de Conteo e Inconsistencias */}
      <div className="stats-grid mb-3">
        <div className="stat-card">
          <div className="stat-icon icon-cyan">
            <i className="bi bi-box-seam"></i>
          </div>
          <div className="stat-value">{metrics.total}</div>
          <div className="stat-label">Catálogo Total</div>
        </div>

        <div className="stat-card">
          <div className="stat-icon icon-emerald">
            <i className="bi bi-check2-circle"></i>
          </div>
          <div className="stat-value" style={{ color: '#10b981' }}>
            {metrics.exactMatches}
          </div>
          <div className="stat-label">Coincidencias Exactas</div>
        </div>

        <div className="stat-card">
          <div className="stat-icon icon-danger">
            <i className="bi bi-arrow-down-circle-fill"></i>
          </div>
          <div className="stat-value" style={{ color: '#ef4444' }}>
            {metrics.faltantesCount}
          </div>
          <div className="stat-label">
            Faltantes (-{metrics.faltantesUnits} uds)
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon icon-amber">
            <i className="bi bi-arrow-up-circle-fill"></i>
          </div>
          <div className="stat-value" style={{ color: '#f59e0b' }}>
            {metrics.sobrantesCount}
          </div>
          <div className="stat-label">
            Sobrantes (+{metrics.sobrantesUnits} uds)
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon icon-purple">
            <i className="bi bi-graph-up-arrow"></i>
          </div>
          <div className="stat-value">
            {metrics.accuracyRate}%
          </div>
          <div className="stat-label">Exactitud de Bodega</div>
        </div>
      </div>

      {/* Selector de Pestañas (Tabs) */}
      <div className="d-flex align-items-center gap-2 mb-3 border-bottom border-secondary pb-2">
        <button
          type="button"
          className={`btn btn-sm ${activeTab === 'conteo' ? 'btn-info text-dark fw-bold' : 'btn-outline-secondary text-light'}`}
          onClick={() => setActiveTab('conteo')}
          style={{ minHeight: '38px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <i className="bi bi-pencil-square"></i>
          <span>Toma de Conteo</span>
          <span className="badge bg-dark text-info ms-1">{filteredItems.length}</span>
        </button>

        <button
          type="button"
          className={`btn btn-sm ${activeTab === 'analisis' ? 'btn-info text-dark fw-bold' : 'btn-outline-secondary text-light'}`}
          onClick={() => setActiveTab('analisis')}
          style={{ minHeight: '38px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <i className="bi bi-pie-chart-fill"></i>
          <span>Inconsistencias y Comparación</span>
          {metrics.totalDifferences > 0 && (
            <span className="badge bg-danger text-light ms-1">{metrics.totalDifferences}</span>
          )}
        </button>
      </div>

      {/* ==================================================================== */}
      {/* PESTAÑA 1: REGISTRO DE CONTEO FÍSICO */}
      {/* ==================================================================== */}
      {activeTab === 'conteo' && (
        <>
          {/* Barra de Filtros y Búsqueda */}
          <div
            className="card mb-3 p-3 shadow-sm"
            style={{ background: 'rgba(15, 15, 35, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)' }}
          >
            {/* Fila 1: Buscador y Filtro de Discrepancia */}
            <div className="row g-2 align-items-center mb-2">
              <div className="col-12 col-md-6 col-lg-7">
                <div className="input-group">
                  <span className="input-group-text bg-dark border-secondary text-secondary">
                    <i className="bi bi-search"></i>
                  </span>
                  <input
                    type="text"
                    className="form-control bg-dark border-secondary text-light"
                    placeholder="Buscar por SKU, nombre, medidas..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ fontSize: '14px' }}
                  />
                  {search && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary text-light"
                      onClick={() => setSearch('')}
                    >
                      <i className="bi bi-x-lg"></i>
                    </button>
                  )}
                </div>
              </div>

              {/* Filtro por estado de discrepancia */}
              <div className="col-12 col-md-6 col-lg-5">
                <select
                  className="form-select bg-dark border-secondary text-light"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{ fontSize: '13px' }}
                >
                  <option value="all">Ver todos los productos ({itemsWithDiff.length})</option>
                  <option value="diff">Solo con inconsistencias ({metrics.totalDifferences})</option>
                  <option value="faltante">Solo faltantes (Físico &lt; Sistema: {metrics.faltantesCount})</option>
                  <option value="sobrante">Solo sobrantes (Físico &gt; Sistema: {metrics.sobrantesCount})</option>
                  <option value="exacto">Solo coincidencias exactas ({metrics.exactMatches})</option>
                  <option value="contados">Solo con conteo &gt; 0 ({metrics.countedItemsCount})</option>
                  <option value="pendientes">Pendientes en 0 ({metrics.pendingZeroCount})</option>
                </select>
              </div>
            </div>

            {/* Fila 2: Familias Principales */}
            <div className="d-flex align-items-center gap-1 flex-wrap pt-2 border-top border-secondary">
              <span className="text-secondary small fw-bold text-uppercase me-2" style={{ fontSize: '11px' }}>
                Familia:
              </span>
              <button
                type="button"
                className={`btn btn-sm ${selectedMainType === 'all' ? 'btn-primary' : 'btn-outline-secondary text-light'}`}
                onClick={() => {
                  setSelectedMainType('all');
                  setSelectedColor('all');
                  setSelectedCategory('all');
                }}
                style={{ fontSize: '12px' }}
              >
                Todos ({itemsWithDiff.length})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${selectedMainType === 'planchas' ? 'btn-info text-dark fw-bold' : 'btn-outline-secondary text-light'}`}
                onClick={() => {
                  setSelectedMainType('planchas');
                  setSelectedCategory('all');
                }}
                style={{ fontSize: '12px' }}
              >
                <i className="bi bi-grid-3x3 me-1"></i>
                Planchas ({planchaToneCounts.all})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${selectedMainType === 'perfiles' ? 'btn-warning text-dark fw-bold' : 'btn-outline-secondary text-light'}`}
                onClick={() => {
                  setSelectedMainType('perfiles');
                  setSelectedColor('all');
                  setSelectedCategory('all');
                }}
                style={{ fontSize: '12px' }}
              >
                <i className="bi bi-rulers me-1"></i>
                Perfiles ({itemsWithDiff.filter((p) => p.mainType === 'perfiles').length})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${selectedMainType === 'accesorios' ? 'btn-secondary text-light fw-bold' : 'btn-outline-secondary text-light'}`}
                onClick={() => {
                  setSelectedMainType('accesorios');
                  setSelectedColor('all');
                  setSelectedCategory('all');
                }}
                style={{ fontSize: '12px' }}
              >
                <i className="bi bi-wrench me-1"></i>
                Accesorios ({itemsWithDiff.filter((p) => p.mainType === 'accesorios').length})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${selectedMainType === 'pinturas' ? 'btn-outline-light' : 'btn-outline-secondary text-light'}`}
                onClick={() => {
                  setSelectedMainType('pinturas');
                  setSelectedColor('all');
                  setSelectedCategory('all');
                }}
                style={{ fontSize: '12px' }}
              >
                <i className="bi bi-paint-bucket me-1"></i>
                Pinturas ({itemsWithDiff.filter((p) => p.mainType === 'pinturas').length})
              </button>

              {(selectedMainType !== 'all' || selectedColor !== 'all' || selectedCategory !== 'all' || statusFilter !== 'all' || search) && (
                <button
                  type="button"
                  className="btn btn-sm btn-link text-info text-decoration-none fw-semibold ms-auto d-inline-flex align-items-center gap-1"
                  onClick={() => {
                    setSelectedMainType('all');
                    setSelectedColor('all');
                    setSelectedCategory('all');
                    setStatusFilter('all');
                    setSearch('');
                  }}
                  style={{ fontSize: '12px' }}
                >
                  <i className="bi bi-x-circle"></i> Limpiar filtros
                </button>
              )}
            </div>

            {/* Sub-barra de Planchas: Tono (Clear, Opal, Bronce) y Modelos */}
            {selectedMainType === 'planchas' && (
              <div
                className="mt-2 p-2 rounded"
                style={{ background: 'rgba(0, 212, 255, 0.05)', border: '1px solid rgba(0, 212, 255, 0.2)' }}
              >
                {/* Tono */}
                <div className="d-flex align-items-center gap-1 flex-wrap mb-1">
                  <span className="text-secondary small fw-bold text-uppercase me-2" style={{ fontSize: '11px' }}>
                    <i className="bi bi-palette text-info me-1"></i>Tono:
                  </span>
                  <button
                    type="button"
                    className={`btn btn-sm ${selectedColor === 'all' ? 'btn-info text-dark fw-bold' : 'btn-outline-secondary text-secondary'}`}
                    onClick={() => setSelectedColor('all')}
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                  >
                    Todas ({planchaToneCounts.all})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${selectedColor === 'clear' ? 'btn-info text-dark fw-bold' : 'btn-outline-secondary text-secondary'}`}
                    onClick={() => setSelectedColor('clear')}
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                  >
                    <i className="bi bi-droplet-half me-1"></i>Solo Clear ({planchaToneCounts.clear})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${selectedColor === 'opal' ? 'btn-light text-dark fw-bold' : 'btn-outline-secondary text-secondary'}`}
                    onClick={() => setSelectedColor('opal')}
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                  >
                    <i className="bi bi-circle-fill me-1" style={{ fontSize: '8px' }}></i>Solo Opal ({planchaToneCounts.opal})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${selectedColor === 'bronce' ? 'btn-warning text-dark fw-bold' : 'btn-outline-secondary text-secondary'}`}
                    onClick={() => setSelectedColor('bronce')}
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                  >
                    <i className="bi bi-sun-fill me-1"></i>Solo Bronce ({planchaToneCounts.bronce})
                  </button>
                </div>

                {/* Modelo */}
                <div className="d-flex align-items-center gap-1 flex-wrap pt-1 border-top border-secondary">
                  <span className="text-secondary small fw-bold text-uppercase me-2" style={{ fontSize: '11px' }}>
                    <i className="bi bi-tag text-secondary me-1"></i>Modelo:
                  </span>
                  <button
                    type="button"
                    className={`btn btn-sm ${selectedCategory === 'all' ? 'btn-outline-info text-info fw-bold' : 'btn-outline-secondary text-secondary'}`}
                    onClick={() => setSelectedCategory('all')}
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                  >
                    Todos
                  </button>
                  {planchaModelList.map((m) => (
                    <button
                      key={m.name}
                      type="button"
                      className={`btn btn-sm ${selectedCategory === m.name ? 'btn-info text-dark fw-bold' : 'btn-outline-secondary text-secondary'}`}
                      onClick={() => setSelectedCategory(m.name)}
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                    >
                      {m.name} ({m.count})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tabla de Conteo Físico (Desktop >= 992px) */}
          <div className="d-none d-lg-block">
            <div className="table-container shadow-sm">
              <table className="table align-middle">
                <thead>
                  <tr>
                    <th style={{ width: '13%' }}>SKU</th>
                    <th style={{ width: '32%' }}>Descripción & Tono</th>
                    <th style={{ width: '13%' }}>Categoría</th>
                    <th style={{ width: '10%' }} className="text-center">Stock Sistema</th>
                    <th style={{ width: '20%' }} className="text-center">Conteo Físico</th>
                    <th style={{ width: '12%' }} className="text-center">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="text-center py-5 text-secondary">
                        <i className="bi bi-search fs-3 d-block mb-2 text-muted"></i>
                        No se encontraron productos con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const style = getCategoryStyle(item.category);
                      return (
                        <tr key={item.id}>
                          {/* SKU */}
                          <td>
                            <code
                              style={{
                                background: 'rgba(0, 212, 255, 0.1)',
                                padding: '3px 8px',
                                borderRadius: '4px',
                                color: 'var(--accent-primary)',
                                fontSize: '13px',
                                fontWeight: 600,
                              }}
                            >
                              {item.sku}
                            </code>
                          </td>

                          {/* Nombre + Badges de Tono */}
                          <td>
                            <div className="fw-semibold text-light">{item.name}</div>
                            {item.color === 'clear' && (
                              <span className="badge me-1 mt-1" style={{ background: 'rgba(0, 212, 255, 0.15)', color: '#00d4ff', border: '1px solid rgba(0, 212, 255, 0.3)', fontSize: '11px' }}>
                                <i className="bi bi-droplet-half me-1"></i>Clear
                              </span>
                            )}
                            {item.color === 'opal' && (
                              <span className="badge me-1 mt-1" style={{ background: 'rgba(255, 255, 255, 0.15)', color: '#f8fafc', border: '1px solid rgba(255, 255, 255, 0.3)', fontSize: '11px' }}>
                                <i className="bi bi-circle-fill me-1" style={{ fontSize: '8px' }}></i>Opal
                              </span>
                            )}
                            {item.color === 'bronce' && (
                              <span className="badge me-1 mt-1" style={{ background: 'rgba(217, 119, 6, 0.2)', color: '#fbbf24', border: '1px solid rgba(217, 119, 6, 0.4)', fontSize: '11px' }}>
                                <i className="bi bi-sun-fill me-1"></i>Bronce
                              </span>
                            )}
                          </td>

                          {/* Categoría */}
                          <td>
                            <span
                              className="category-badge"
                              style={{
                                background: style.bg,
                                color: style.color,
                                border: `1px solid ${style.color}33`,
                              }}
                            >
                              <i className={`bi ${style.icon}`} style={{ fontSize: '10px' }}></i>
                              {(item.category || 'SIN CATEGORÍA').toUpperCase()}
                            </span>
                          </td>

                          {/* Stock Sistema (Teórico) */}
                          <td className="text-center font-monospace fs-6 fw-bold text-light">
                            {item.systemQty}
                          </td>

                          {/* Conteo Físico (Stepper + Input Directo + Botones Rápidos) */}
                          <td>
                            <div className="d-flex align-items-center justify-content-center gap-1">
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm text-light px-2"
                                onClick={() => adjustCount(item.id, -10)}
                                title="Restar 10"
                              >
                                -10
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm text-light px-2"
                                onClick={() => adjustCount(item.id, -1)}
                                title="Restar 1"
                              >
                                −
                              </button>

                              <input
                                type="number"
                                min="0"
                                className="form-control form-control-sm text-center font-monospace fw-bold"
                                value={countedMap[item.id] ?? 0}
                                onChange={(e) => setCountForProduct(item.id, e.target.value)}
                                style={{
                                  width: '70px',
                                  background: 'rgba(0, 0, 0, 0.5)',
                                  color: (countedMap[item.id] ?? 0) > 0 ? '#00d4ff' : 'var(--text-secondary)',
                                  borderColor: (countedMap[item.id] ?? 0) > 0 ? '#00d4ff55' : 'var(--border-color)',
                                  fontSize: '15px',
                                }}
                              />

                              <button
                                type="button"
                                className="btn btn-outline-info btn-sm text-info px-2"
                                onClick={() => adjustCount(item.id, 1)}
                                title="Sumar 1"
                              >
                                +
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline-info btn-sm text-info px-2"
                                onClick={() => adjustCount(item.id, 10)}
                                title="Sumar 10"
                              >
                                +10
                              </button>

                              <button
                                type="button"
                                className="btn btn-sm btn-link text-secondary p-1 ms-1"
                                onClick={() => setEqualToSystem(item)}
                                title="Marcar igual al stock del sistema"
                              >
                                <i className="bi bi-check2 text-success"></i>
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-link text-secondary p-1"
                                onClick={() => setToZero(item.id)}
                                title="Poner en 0"
                              >
                                <i className="bi bi-x text-danger"></i>
                              </button>
                            </div>
                            {updatedByMap[item.id] && (
                              <div className="text-secondary text-center mt-1" style={{ fontSize: '10px' }}>
                                <i className="bi bi-person text-info me-1"></i>
                                {updatedByMap[item.id].userName} • {updatedByMap[item.id].time}
                              </div>
                            )}
                          </td>

                          {/* Diferencia (Físico - Teórico) */}
                          <td className="text-center">
                            {item.diff === 0 ? (
                              <span
                                className="badge"
                                style={{
                                  background: 'rgba(16, 185, 129, 0.15)',
                                  color: '#10b981',
                                  border: '1px solid rgba(16, 185, 129, 0.3)',
                                  fontSize: '12px',
                                  padding: '4px 8px',
                                }}
                              >
                                <i className="bi bi-check-circle-fill me-1"></i> Exacto (0)
                              </span>
                            ) : item.diff < 0 ? (
                              <span
                                className="badge"
                                style={{
                                  background: 'rgba(239, 68, 68, 0.15)',
                                  color: '#ef4444',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  fontSize: '12px',
                                  padding: '4px 8px',
                                }}
                              >
                                <i className="bi bi-dash-circle-fill me-1"></i> Faltante ({item.diff})
                              </span>
                            ) : (
                              <span
                                className="badge"
                                style={{
                                  background: 'rgba(245, 158, 11, 0.15)',
                                  color: '#f59e0b',
                                  border: '1px solid rgba(245, 158, 11, 0.3)',
                                  fontSize: '12px',
                                  padding: '4px 8px',
                                }}
                              >
                                <i className="bi bi-plus-circle-fill me-1"></i> Sobrante (+{item.diff})
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cards responsivas para Móviles y Tablets (< 992px) */}
          <div className="d-block d-lg-none">
            <div className="row g-2">
              {filteredItems.map((item) => {
                const style = getCategoryStyle(item.category);
                return (
                  <div key={item.id} className="col-12 col-md-6">
                    <div
                      className="card p-3 shadow-sm h-100"
                      style={{
                        background: 'rgba(15, 15, 35, 0.95)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                      }}
                    >
                      {/* Cabecera Tarjeta: SKU y Categoría */}
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <code className="text-info fw-bold" style={{ fontSize: '13px' }}>
                          {item.sku}
                        </code>
                        <span
                          className="badge"
                          style={{
                            background: style.bg,
                            color: style.color,
                            fontSize: '10px',
                          }}
                        >
                          {(item.category || 'SIN CATEGORÍA').toUpperCase()}
                        </span>
                      </div>

                      {/* Nombre y Tono */}
                      <div className="fw-semibold text-light mb-2" style={{ fontSize: '14px' }}>
                        {item.name}
                        {item.color === 'clear' && (
                          <span className="badge ms-2" style={{ background: 'rgba(0, 212, 255, 0.15)', color: '#00d4ff', fontSize: '10px' }}>
                            Clear
                          </span>
                        )}
                        {item.color === 'opal' && (
                          <span className="badge ms-2" style={{ background: 'rgba(255, 255, 255, 0.15)', color: '#f8fafc', fontSize: '10px' }}>
                            Opal
                          </span>
                        )}
                        {item.color === 'bronce' && (
                          <span className="badge ms-2" style={{ background: 'rgba(217, 119, 6, 0.2)', color: '#fbbf24', fontSize: '10px' }}>
                            Bronce
                          </span>
                        )}
                      </div>

                      {/* Comparación Sistema vs Físico */}
                      <div
                        className="p-2 rounded mb-2 d-flex justify-content-between align-items-center"
                        style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}
                      >
                        <div>
                          <small className="text-secondary d-block" style={{ fontSize: '10px' }}>STOCK SISTEMA</small>
                          <span className="fs-5 fw-bold font-monospace text-light">{item.systemQty} uds</span>
                        </div>
                        <div className="text-end">
                          <small className="text-secondary d-block" style={{ fontSize: '10px' }}>DIFERENCIA</small>
                          {item.diff === 0 ? (
                            <span className="badge bg-success text-light">Exacto (0)</span>
                          ) : item.diff < 0 ? (
                            <span className="badge bg-danger text-light">Faltante ({item.diff})</span>
                          ) : (
                            <span className="badge bg-warning text-dark fw-bold">Sobrante (+{item.diff})</span>
                          )}
                        </div>
                      </div>

                      {/* Stepper Táctil Grande */}
                      <div className="d-flex align-items-center justify-content-between gap-1 mt-auto pt-2 border-top border-secondary">
                        <div className="btn-group" role="group">
                          <button
                            type="button"
                            className="btn btn-outline-secondary text-light fw-bold"
                            style={{ minWidth: '42px', minHeight: '42px' }}
                            onClick={() => adjustCount(item.id, -1)}
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min="0"
                            className="btn btn-dark text-info fw-bold font-monospace text-center"
                            style={{ width: '65px', minHeight: '42px', fontSize: '16px', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                            value={countedMap[item.id] ?? 0}
                            onChange={(e) => setCountForProduct(item.id, e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn btn-outline-info text-info fw-bold"
                            style={{ minWidth: '42px', minHeight: '42px' }}
                            onClick={() => adjustCount(item.id, 1)}
                          >
                            +
                          </button>
                        </div>

                        <div className="d-flex gap-1">
                          <button
                            type="button"
                            className="btn btn-outline-success btn-sm px-2"
                            style={{ minHeight: '42px' }}
                            onClick={() => setEqualToSystem(item)}
                            title="Igualar a sistema"
                          >
                            <i className="bi bi-check2"></i>
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm px-2 text-danger"
                            style={{ minHeight: '42px' }}
                            onClick={() => setToZero(item.id)}
                            title="Poner en 0"
                          >
                            0
                          </button>
                        </div>
                      </div>

                      {updatedByMap[item.id] && (
                        <div className="text-secondary text-end mt-2 pt-1 border-top border-secondary" style={{ fontSize: '11px' }}>
                          <i className="bi bi-person-fill text-info me-1"></i>
                          {updatedByMap[item.id].userName} • {updatedByMap[item.id].time}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ==================================================================== */}
      {/* PESTAÑA 2: INCONSISTENCIAS Y COMPARACIÓN ANALÍTICA */}
      {/* ==================================================================== */}
      {activeTab === 'analisis' && (
        <div className="d-flex flex-column gap-3">
          {/* Tarjeta de Resumen por Familias */}
          <div
            className="card p-3 shadow-sm"
            style={{ background: 'rgba(15, 15, 35, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)' }}
          >
            <div className="card-title mb-3 d-flex align-items-center gap-2">
              <i className="bi bi-diagram-3-fill text-info"></i>
              <span>Distribución de Inconsistencias por Familia</span>
            </div>

            <div className="row g-2">
              {familySummary.map((fam) => (
                <div key={fam.label} className="col-12 col-sm-6 col-lg">
                  <div
                    className="p-3 rounded h-100"
                    style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}
                  >
                    <div className="text-secondary small fw-bold text-uppercase" style={{ fontSize: '11px' }}>
                      {fam.label}
                    </div>
                    <div className="fs-4 fw-bold text-light mt-1">
                      {fam.diffs} <span className="fs-6 text-secondary fw-normal">con diff</span>
                    </div>
                    <div className="small mt-1" style={{ color: fam.netDiff < 0 ? '#ef4444' : fam.netDiff > 0 ? '#f59e0b' : '#10b981' }}>
                      {fam.netDiff === 0 ? 'Sin descuadre neto' : `Descuadre neto: ${fam.netDiff > 0 ? `+${fam.netDiff}` : fam.netDiff} uds`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabla de Productos con Inconsistencias */}
          <div
            className="card p-3 shadow-sm"
            style={{ background: 'rgba(15, 15, 35, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)' }}
          >
            <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
              <div>
                <h3 className="card-title mb-1 d-flex align-items-center gap-2">
                  <i className="bi bi-exclamation-triangle-fill text-warning"></i>
                  <span>Detalle de Inconsistencias ({itemsWithDiff.filter((d) => d.diff !== 0).length} productos)</span>
                </h3>
                <p className="text-secondary small mb-0">
                  Artículos donde el conteo físico en bodega difiere del stock teórico registrado en el sistema.
                </p>
              </div>

              <button
                type="button"
                className="btn btn-primary btn-sm d-inline-flex align-items-center gap-2"
                onClick={handleExportExcel}
              >
                <i className="bi bi-file-earmark-excel-fill"></i>
                <span>Descargar en Excel</span>
              </button>
            </div>

            {itemsWithDiff.filter((d) => d.diff !== 0).length === 0 ? (
              <div className="empty-state py-5 text-center">
                <i className="bi bi-check-circle-fill text-success fs-1 mb-2"></i>
                <div className="empty-state-title">¡Sin inconsistencias detectadas!</div>
                <div className="empty-state-text text-secondary">
                  El conteo físico coincide exactamente con el inventario registrado en el sistema.
                </div>
              </div>
            ) : (
              <div className="table-container">
                <table className="table align-middle">
                  <thead>
                    <tr>
                      <th>Estado</th>
                      <th>SKU</th>
                      <th>Descripción</th>
                      <th>Categoría</th>
                      <th className="text-center">Stock Sistema</th>
                      <th className="text-center">Conteo Físico</th>
                      <th className="text-center">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsWithDiff
                      .filter((d) => d.diff !== 0)
                      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
                      .map((diffItem) => (
                        <tr key={diffItem.id}>
                          <td>
                            {diffItem.diff < 0 ? (
                              <span className="badge badge-danger d-inline-flex align-items-center gap-1">
                                <i className="bi bi-dash-circle-fill"></i> Faltante
                              </span>
                            ) : (
                              <span className="badge badge-warning d-inline-flex align-items-center gap-1">
                                <i className="bi bi-plus-circle-fill"></i> Sobrante
                              </span>
                            )}
                          </td>
                          <td>
                            <code className="text-info fw-bold">{diffItem.sku}</code>
                          </td>
                          <td className="text-light fw-semibold">{diffItem.name}</td>
                          <td>
                            <span className="badge bg-secondary opacity-75">{diffItem.category}</span>
                          </td>
                          <td className="text-center font-monospace fw-bold">{diffItem.systemQty}</td>
                          <td className="text-center font-monospace fw-bold text-info">{diffItem.countedQty}</td>
                          <td className="text-center">
                            <span
                              className={`fw-bold font-monospace fs-6 ${
                                diffItem.diff < 0 ? 'text-danger' : 'text-warning'
                              }`}
                            >
                              {diffItem.diff > 0 ? `+${diffItem.diff}` : diffItem.diff} uds
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 1: ESCÁNER RÁPIDO DE CÓDIGO DE BARRAS */}
      {/* ==================================================================== */}
      {showScannerModal && (
        <div className="modal-overlay" onClick={() => setShowScannerModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2 className="modal-title d-flex align-items-center gap-2">
                <i className="bi bi-camera text-info"></i>
                <span>Escáner de Bodega</span>
              </h2>
              <button
                className="modal-close"
                onClick={() => setShowScannerModal(false)}
                aria-label="Cerrar modal"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body">
              <p className="text-secondary small mb-3">
                Apunta la cámara al código de barras del producto o escribe el SKU manualmente. Cada escaneo sumará +1 unidad física.
              </p>

              {/* Componente Cámara */}
              <div className="mb-3">
                <BarcodeScanner onScan={handleBarcodeScan} />
              </div>

              {/* Mensaje de escaneo */}
              {lastScannedMsg && (
                <div
                  className={`alert ${lastScannedMsg.success ? 'alert-success' : 'alert-danger'} p-2 small mb-3 d-flex align-items-center gap-2`}
                >
                  <i className={`bi ${lastScannedMsg.success ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}`}></i>
                  <span>{lastScannedMsg.text}</span>
                </div>
              )}

              {/* Búsqueda manual por teclado o lector USB */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const code = e.currentTarget.elements.manualCode.value;
                  if (code) {
                    handleBarcodeScan(code);
                    e.currentTarget.elements.manualCode.value = '';
                  }
                }}
                className="d-flex gap-2"
              >
                <input
                  name="manualCode"
                  type="text"
                  className="form-control bg-dark border-secondary text-light"
                  placeholder="Ingresar o escanear SKU con pistola..."
                  autoFocus
                />
                <button type="submit" className="btn btn-info text-dark fw-bold px-3">
                  <i className="bi bi-plus-lg"></i>
                </button>
              </form>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowScannerModal(false)}
              >
                Cerrar Escáner
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 2: APLICAR CONTEO AL INVENTARIO REAL */}
      {/* ==================================================================== */}
      {showApplyModal && (
        <div className="modal-overlay" onClick={() => !applying && setShowApplyModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px' }}>
            <div className="modal-header">
              <h2 className="modal-title d-flex align-items-center gap-2 text-warning">
                <i className="bi bi-shield-exclamation"></i>
                <span>Conciliar e Impactar Inventario Real</span>
              </h2>
              <button
                className="modal-close"
                onClick={() => !applying && setShowApplyModal(false)}
                disabled={applying}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body">
              <div className="alert alert-warning small mb-3">
                <i className="bi bi-exclamation-triangle-fill me-1"></i>
                <strong>Atención:</strong> Esta acción sobrescribirá las existencias en la base de datos de Puerto Montt con las cantidades físicas registradas en esta auditoría.
              </div>

              <div
                className="p-3 rounded mb-3"
                style={{ background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.08)' }}
              >
                <div className="d-flex justify-content-between py-1 border-bottom border-secondary">
                  <span className="text-secondary">Productos a modificar:</span>
                  <strong className="text-warning font-monospace">{metrics.totalDifferences} artículos</strong>
                </div>
                <div className="d-flex justify-content-between py-1 border-bottom border-secondary">
                  <span className="text-secondary">Unidades con faltante:</span>
                  <strong className="text-danger font-monospace">-{metrics.faltantesUnits} uds ({metrics.faltantesCount} productos)</strong>
                </div>
                <div className="d-flex justify-content-between py-1 border-bottom border-secondary">
                  <span className="text-secondary">Unidades con sobrante:</span>
                  <strong className="text-success font-monospace">+{metrics.sobrantesUnits} uds ({metrics.sobrantesCount} productos)</strong>
                </div>
                <div className="d-flex justify-content-between py-1">
                  <span className="text-secondary">Variación neta en bodega:</span>
                  <strong className="text-light font-monospace">
                    {metrics.netUnitsDiff > 0 ? `+${metrics.netUnitsDiff}` : metrics.netUnitsDiff} uds
                  </strong>
                </div>
              </div>

              <p className="text-secondary small mb-0">
                Se guardará un respaldo automático en el Historial de Auditorías y se notificará al equipo.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowApplyModal(false)}
                disabled={applying}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-warning text-dark fw-bold d-inline-flex align-items-center gap-2"
                onClick={handleApplyCountToMaster}
                disabled={applying || metrics.totalDifferences === 0}
              >
                {applying ? (
                  <>
                    <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                    <span>Actualizando Firestore...</span>
                  </>
                ) : (
                  <>
                    <i className="bi bi-check-circle-fill"></i>
                    <span>Confirmar y Actualizar Stock</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 3: CONFIRMAR REINICIO A CERO */}
      {/* ==================================================================== */}
      {showResetModal && (
        <div className="modal-overlay" onClick={() => setShowResetModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h2 className="modal-title d-flex align-items-center gap-2 text-danger">
                <i className="bi bi-trash3-fill"></i>
                <span>¿Reiniciar Conteo a 0?</span>
              </h2>
              <button className="modal-close" onClick={() => setShowResetModal(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="modal-body">
              <p className="text-secondary mb-0">
                Esta acción restablecerá todas las cantidades del conteo físico a 0. El inventario real en Firestore no se verá afectado.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowResetModal(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleResetAll}
              >
                Sí, Reiniciar Todo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
