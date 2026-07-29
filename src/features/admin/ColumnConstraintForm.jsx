import React, { useState, useEffect } from "react";
import {
  subscribeToConstraints,
  addConstraint,
  updateConstraint,
  deleteConstraint
} from "./columnConstraintsService";

/**
 * 🛠️ Utility Function: Clean Data Object (Payload Formatter)
 * تقوم بتنظيف وتنسيق الكائن قبل إرساله لقواعد البيانات
 */
export const cleanConstraintPayload = (rawForm, allBranches = [], allItems = []) => {
  const { name, action, dates, selectedBranchIds, selectedItemIds, globalLockColumns, itemConfigurations } = rawForm;

  // 1. معالجة الفروع (إذا تم اختيار الكل أو مصفوفة فارغة -> [] للكل)
  const isAllBranches =
    selectedBranchIds.length === 0 ||
    (allBranches.length > 0 && selectedBranchIds.length === allBranches.length);
  const cleanedBranchIds = isAllBranches ? [] : selectedBranchIds;

  // 2. معالجة التواريخ حسب نوع الـ action
  let cleanedDates = [];
  if (action === "lock") {
    cleanedDates = dates.filter((d) => d && d.trim() !== "");
  } else {
    cleanedDates = []; // دائمًا فارغة بالنسبة لـ default_value و max_value
  }

  // 3. معالجة الأصناف والأعمدة حسب الـ action
  let cleanedItems = [];

  const isAllItems =
    selectedItemIds.length === 0 ||
    (allItems.length > 0 && selectedItemIds.length === allItems.length);

  const targetItemIds = isAllItems
    ? allItems.map((i) => i.id || i._id)
    : selectedItemIds;

  if (action === "lock") {
    // قفل الأعمدة: مرونة اختيار الأعمدة لكل منتج على حدة
    cleanedItems = targetItemIds.map((itemId) => {
      const customCols = itemConfigurations[itemId]?.lockColumns;
      const activeCols = customCols !== undefined ? customCols : globalLockColumns;
      return {
        itemId,
        columns: activeCols.filter((col) => ["transfer", "staffMeal"].includes(col))
      };
    }).filter((it) => it.columns.length > 0);
  } else if (action === "default_value") {
    // القيمة الافتراضية: staffMeal فقط
    cleanedItems = targetItemIds
      .map((itemId) => {
        const itemConfig = itemConfigurations[itemId]?.defaultValue || {};
        const staffMealConfig = itemConfig.staffMeal;

        if (staffMealConfig && staffMealConfig.enabled) {
          return {
            itemId,
            columns: {
              staffMeal: {
                qnt: Number(staffMealConfig.qnt) || 0,
                enabled: true
              }
            }
          };
        }
        return null;
      })
      .filter(Boolean);
  } else if (action === "max_value") {
    // الحد الأقصى للقيمة: تخزين القيمة العظمى المباشرة للعمود فقط
    // الهيكل: "columns": { "dameged": 50, "transfer": 50, "staffMeal": 50 }
    cleanedItems = targetItemIds
      .map((itemId) => {
        const itemConfig = itemConfigurations[itemId]?.maxValue || {};
        const columnsObj = {};

        ["dameged", "transfer", "staffMeal"].forEach((colKey) => {
          const colData = itemConfig[colKey];
          const numVal = typeof colData === "object" ? colData.max_value : colData;
          const isEnabled = typeof colData === "object" ? colData.enabled : (numVal !== undefined && numVal !== "");

          if (isEnabled && numVal !== undefined && numVal !== "") {
            columnsObj[colKey] = Number(numVal);
          }
        });

        if (Object.keys(columnsObj).length > 0) {
          return {
            itemId,
            columns: columnsObj
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  return {
    name: name?.trim() || "قيد بدون عنوان",
    action,
    dates: cleanedDates,
    branchIds: cleanedBranchIds,
    items: cleanedItems,
    updatedAt: new Date().toISOString()
  };
};

// ----------------------------------------------------------------------
// 📦 نافذة إدخال وتعديل القيود (Constraint Modal Form)
// ----------------------------------------------------------------------
const ConstraintFormModal = ({
  isOpen,
  onClose,
  editingConstraint,
  branches = [],
  items = []
}) => {
  const [name, setName] = useState("");
  const [action, setAction] = useState("lock");
  const [dates, setDates] = useState([]);
  const [dateInput, setDateInput] = useState("");
  const [selectedBranchIds, setSelectedBranchIds] = useState([]);
  const [selectedItemIds, setSelectedItemIds] = useState([]);

  // الأعمدة المحددة عامة للقفل
  const [globalLockColumns, setGlobalLockColumns] = useState(["transfer", "staffMeal"]);

  // إعدادات مخصصة لكل صنف
  const [itemConfigurations, setItemConfigurations] = useState({});

  useEffect(() => {
    if (editingConstraint) {
      setName(editingConstraint.name || editingConstraint.title || "");
      setAction(editingConstraint.action || "lock");
      setDates(editingConstraint.dates || []);
      setSelectedBranchIds(editingConstraint.branchIds || []);

      const editingItemIds = editingConstraint.items?.map((i) => i.itemId) || [];
      setSelectedItemIds(editingItemIds);

      const initialConfigs = {};
      if (editingConstraint.items && Array.isArray(editingConstraint.items)) {
        editingConstraint.items.forEach((item) => {
          if (editingConstraint.action === "lock") {
            initialConfigs[item.itemId] = {
              lockColumns: item.columns || ["transfer", "staffMeal"]
            };
          } else if (editingConstraint.action === "default_value") {
            initialConfigs[item.itemId] = {
              defaultValue: {
                staffMeal: {
                  qnt: item.columns?.staffMeal?.qnt ?? 0,
                  enabled: !!item.columns?.staffMeal?.enabled
                }
              }
            };
          } else if (editingConstraint.action === "max_value") {
            const cols = item.columns || {};
            initialConfigs[item.itemId] = {
              maxValue: {
                dameged: {
                  max_value: typeof cols.dameged === "object" ? cols.dameged.max_value : cols.dameged ?? "",
                  enabled: cols.dameged !== undefined
                },
                transfer: {
                  max_value: typeof cols.transfer === "object" ? cols.transfer.max_value : cols.transfer ?? "",
                  enabled: cols.transfer !== undefined
                },
                staffMeal: {
                  max_value: typeof cols.staffMeal === "object" ? cols.staffMeal.max_value : cols.staffMeal ?? "",
                  enabled: cols.staffMeal !== undefined
                }
              }
            };
          }
        });
      }
      setItemConfigurations(initialConfigs);
    } else {
      resetForm();
    }
  }, [editingConstraint, isOpen]);

  // عند تغيير نوع الإجراء إلى default_value -> تحديد المنتج الأول فقط كخيار آمن
  useEffect(() => {
    if (!editingConstraint && action === "default_value" && items.length > 0) {
      const firstItemId = items[0].id || items[0]._id;
      setSelectedItemIds([firstItemId]);
      setItemConfigurations({
        [firstItemId]: {
          defaultValue: {
            staffMeal: { qnt: 0, enabled: true }
          }
        }
      });
    }
  }, [action, editingConstraint]);

  const resetForm = () => {
    setName("");
    setAction("lock");
    setDates([]);
    setDateInput("");
    setSelectedBranchIds([]);
    if (items.length > 0) {
      const firstId = items[0].id || items[0]._id;
      setSelectedItemIds([firstId]);
    } else {
      setSelectedItemIds([]);
    }
    setGlobalLockColumns(["transfer", "staffMeal"]);
    setItemConfigurations({});
  };

  if (!isOpen) return null;

  // --- التحكم بالتواريخ ---
  const handleAddDate = () => {
    if (dateInput && !dates.includes(dateInput)) {
      setDates([...dates, dateInput]);
      setDateInput("");
    }
  };

  const handleRemoveDate = (d) => {
    setDates(dates.filter((item) => item !== d));
  };

  const handleSelectAllDates = () => {
    setDates([]); // مصفوفة فارغة تعني الكل
  };

  // --- التحكم بالفروع ---
  const handleSelectAllBranches = () => {
    const allIds = branches.map((b) => b.id || b._id);
    setSelectedBranchIds(allIds);
  };

  const handleDeselectAllBranches = () => {
    setSelectedBranchIds([]);
  };

  const handleBranchToggle = (branchId) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    );
  };

  // --- التحكم بالأصناف ---
  const handleSelectAllItems = () => {
    const allIds = items.map((i) => i.id || i._id);
    setSelectedItemIds(allIds);
  };

  const handleDeselectAllItems = () => {
    setSelectedItemIds([]);
  };

  const handleSelectFirstItemOnly = () => {
    if (items.length > 0) {
      const firstId = items[0].id || items[0]._id;
      setSelectedItemIds([firstId]);
    }
  };

  const handleItemToggle = (itemId) => {
    setSelectedItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  // --- أجهزة تحكم الأعمدة لقفل الحقول ---
  const handleGlobalLockColToggle = (colKey) => {
    setGlobalLockColumns((prev) =>
      prev.includes(colKey) ? prev.filter((c) => c !== colKey) : [...prev, colKey]
    );
  };

  const handleItemLockColToggle = (itemId, colKey) => {
    setItemConfigurations((prev) => {
      const currentItemConfig = prev[itemId] || {};
      const currentCols = currentItemConfig.lockColumns || [...globalLockColumns];
      const newCols = currentCols.includes(colKey)
        ? currentCols.filter((c) => c !== colKey)
        : [...currentCols, colKey];

      return {
        ...prev,
        [itemId]: {
          ...currentItemConfig,
          lockColumns: newCols
        }
      };
    });
  };

  // --- التحكم بالقيم الافتراضية والحد الأقصى ---
  const handleDefaultValueChange = (itemId, field, value) => {
    setItemConfigurations((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        defaultValue: {
          staffMeal: {
            ...prev[itemId]?.defaultValue?.staffMeal,
            [field]: value
          }
        }
      }
    }));
  };

  const handleMaxValueChange = (itemId, colKey, field, value) => {
    setItemConfigurations((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        maxValue: {
          ...prev[itemId]?.maxValue,
          [colKey]: {
            ...prev[itemId]?.maxValue?.[colKey],
            [field]: value
          }
        }
      }
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      alert("يرجى إدخال تسمية القيد");
      return;
    }

    const cleanedPayload = cleanConstraintPayload(
      {
        name,
        action,
        dates,
        selectedBranchIds,
        selectedItemIds,
        globalLockColumns,
        itemConfigurations
      },
      branches,
      items
    );

    try {
      if (editingConstraint?.id) {
        await updateConstraint(editingConstraint.id, cleanedPayload);
      } else {
        await addConstraint({
          ...cleanedPayload,
          createdAt: new Date().toISOString()
        });
      }
      onClose();
    } catch (err) {
      console.error("Error saving constraint:", err);
      alert("حدث خطأ أثناء حفظ القيد");
    }
  };

  return (
    <div style={modalOverlayStyle}>
      <div style={modalContentStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e5e7eb", paddingBottom: "12px", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", margin: 0, color: "#111827" }}>
            {editingConstraint ? "✏️ تعديل القيد" : "➕ إضافة قيد جديد"}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer", color: "#6b7280" }}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* تسمية القيد */}
          <div>
            <label style={labelStyle}>تسمية القيد (Constraint Name): *</label>
            <input
              type="text"
              placeholder="مثال: قفل تحويلات الفرع الرئيسي / حد أقصى الوجبات"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          {/* نوع الإجراء action */}
          <div>
            <label style={labelStyle}>نوع الإجراء (Action Rule):</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              disabled={!!editingConstraint}
              style={{ ...inputStyle, backgroundColor: editingConstraint ? "#f3f4f6" : "#fff" }}
            >
              <option value="lock">🔒 قفل (Lock)</option>
              <option value="default_value">📌 قيمة افتراضية (Default Value)</option>
              <option value="max_value">⚡ الحد الأقصى للقيمة (Max Value)</option>
            </select>
          </div>

          {/* التواريخ dates (متاحة في Lock فقط) */}
          {action === "lock" ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label style={labelStyle}>التواريخ (Dates):</label>
                <button type="button" onClick={handleSelectAllDates} style={smallButtonStyle}>
                  {dates.length === 0 ? "✅ محدد: الكل []" : "تحديد الكل (تفرغ المصفوفة [])"}
                </button>
              </div>
              <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                <input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  type="button"
                  onClick={handleAddDate}
                  style={{ backgroundColor: "#2563eb", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "4px", cursor: "pointer" }}
                >
                  إضافة تاريخ
                </button>
              </div>
              {dates.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {dates.map((d) => (
                    <span key={d} style={badgeStyle}>
                      {d}
                      <button
                        type="button"
                        onClick={() => handleRemoveDate(d)}
                        style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", marginRight: "4px" }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <span style={noteStyle}>🌐 مفعل لجميع التواريخ (dates: [])</span>
              )}
            </div>
          ) : (
            <div style={{ backgroundColor: "#f9fafb", padding: "8px 12px", borderRadius: "6px", border: "1px dashed #d1d5db" }}>
              <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                ℹ️ حقل التواريخ غير متاح لهذا الإجراء وسيتم حفظه تلقائياً كمصفوفة فارغة <code>dates: []</code>.
              </span>
            </div>
          )}

          {/* الفروع branchIds */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <label style={labelStyle}>الفروع (Branches):</label>
              <div style={{ display: "flex", gap: "6px" }}>
                <button type="button" onClick={handleSelectAllBranches} style={smallButtonStyle}>
                  تحديد الكل ({branches.length})
                </button>
                <button type="button" onClick={handleDeselectAllBranches} style={{ ...smallButtonStyle, backgroundColor: "#fee2e2", color: "#991b1b" }}>
                  إلغاء الكل ([])
                </button>
              </div>
            </div>
            <div style={scrollBoxStyle}>
              {branches.length > 0 ? (
                branches.map((b) => {
                  const bId = b.id || b._id;
                  const isChecked = selectedBranchIds.includes(bId);
                  return (
                    <label key={bId} style={checkboxLabelStyle}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleBranchToggle(bId)}
                      />
                      <span>{b.name || b.title || bId}</span>
                    </label>
                  );
                })
              ) : (
                <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>لا توجد فروع مسجلة</span>
              )}
            </div>
            {selectedBranchIds.length === 0 && (
              <span style={noteStyle}>🌐 ينطبق على جميع الفروع (branchIds: [])</span>
            )}
          </div>

          {/* الأصناف والأعمدة */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <label style={labelStyle}>الأصناف (Items):</label>
              <div style={{ display: "flex", gap: "6px" }}>
                <button type="button" onClick={handleSelectFirstItemOnly} style={{ ...smallButtonStyle, backgroundColor: "#e0e7ff", color: "#1d4ed8" }}>
                  🎯 أول صنف فقط
                </button>
                <button type="button" onClick={handleSelectAllItems} style={smallButtonStyle}>
                  تحديد الكل ({items.length})
                </button>
                <button type="button" onClick={handleDeselectAllItems} style={{ ...smallButtonStyle, backgroundColor: "#fee2e2", color: "#991b1b" }}>
                  إلغاء الكل ([])
                </button>
              </div>
            </div>

            {/* الخيارات العامة للقفل */}
            {action === "lock" && (
              <div style={{ backgroundColor: "#fef2f2", padding: "12px", borderRadius: "6px", marginBottom: "12px", border: "1px solid #fecaca" }}>
                <label style={{ ...labelStyle, color: "#991b1b" }}>الأعمدة العامة المتاحة للقفل:</label>
                <div style={{ display: "flex", gap: "16px", marginTop: "6px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={globalLockColumns.includes("transfer")}
                      onChange={() => handleGlobalLockColToggle("transfer")}
                    />
                    <span>التحويل (transfer)</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={globalLockColumns.includes("staffMeal")}
                      onChange={() => handleGlobalLockColToggle("staffMeal")}
                    />
                    <span>وجبة الموظف (staffMeal)</span>
                  </label>
                </div>
              </div>
            )}

            {/* قائمة الأصناف وتخصيص كل صنف */}
            <div style={{ ...scrollBoxStyle, maxHeight: "240px" }}>
              {items.length > 0 ? (
                items.map((item) => {
                  const itemId = item.id || item._id;
                  const isChecked = selectedItemIds.includes(itemId);
                  const customLockCols = itemConfigurations[itemId]?.lockColumns || [...globalLockColumns];

                  return (
                    <div key={itemId} style={{ borderBottom: "1px solid #e5e7eb", paddingBottom: "8px", marginBottom: "8px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "bold", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleItemToggle(itemId)}
                        />
                        <span>{item.name || item.title || itemId}</span>
                      </label>

                      {/* تخصيص القفل للمنتج المختار */}
                      {action === "lock" && isChecked && (
                        <div style={{ marginRight: "24px", marginTop: "6px", padding: "8px", backgroundColor: "#fff5f5", borderRadius: "6px", border: "1px solid #fed7d7" }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: "bold", color: "#9b2c2c", display: "block", marginBottom: "4px" }}>
                            أعمدة القفل المخصصة لهذا المنتج:
                          </span>
                          <div style={{ display: "flex", gap: "16px" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.8rem", cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={customLockCols.includes("transfer")}
                                onChange={() => handleItemLockColToggle(itemId, "transfer")}
                              />
                              <span>التحويل (transfer)</span>
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.8rem", cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={customLockCols.includes("staffMeal")}
                                onChange={() => handleItemLockColToggle(itemId, "staffMeal")}
                              />
                              <span>وجبة الموظف (staffMeal)</span>
                            </label>
                          </div>
                        </div>
                      )}

                      {/* تخصيص Default Value للمنتج المختار */}
                      {action === "default_value" && isChecked && (
                        <div style={{ marginRight: "24px", marginTop: "6px", padding: "8px", backgroundColor: "#eff6ff", borderRadius: "6px", border: "1px solid #bfdbfe" }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: "bold", color: "#1d4ed8", display: "block", marginBottom: "4px" }}>
                            عمود وجبة الموظف (staffMeal فقط):
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.85rem" }}>
                              <input
                                type="checkbox"
                                checked={itemConfigurations[itemId]?.defaultValue?.staffMeal?.enabled ?? true}
                                onChange={(e) => handleDefaultValueChange(itemId, "enabled", e.target.checked)}
                              />
                              <span>تفعيل</span>
                            </label>

                            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              <span style={{ fontSize: "0.85rem" }}>الكمية الافتراضية (qnt):</span>
                              <input
                                type="number"
                                value={itemConfigurations[itemId]?.defaultValue?.staffMeal?.qnt ?? 0}
                                onChange={(e) => handleDefaultValueChange(itemId, "qnt", e.target.value)}
                                style={{ width: "70px", padding: "2px 6px", border: "1px solid #ccc", borderRadius: "4px" }}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* تخصيص Max Value للمنتج المختار (تخزين أقصى قيمة مباشرة) */}
                      {action === "max_value" && isChecked && (
                        <div style={{ marginRight: "24px", marginTop: "6px", padding: "8px", backgroundColor: "#f0fdf4", borderRadius: "6px", border: "1px solid #bbf7d0" }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: "bold", color: "#15803d", display: "block", marginBottom: "6px" }}>
                            تحديد أقصى قيمة لكل عمود (بدون حقل الكمية):
                          </span>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "8px" }}>
                            {["dameged", "transfer", "staffMeal"].map((colKey) => {
                              const colConfig = itemConfigurations[itemId]?.maxValue?.[colKey] || {};
                              return (
                                <div key={colKey} style={{ border: "1px solid #d1d5db", padding: "6px", borderRadius: "4px", backgroundColor: "#fff" }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: "4px", fontWeight: "bold", fontSize: "0.8rem", cursor: "pointer" }}>
                                    <input
                                      type="checkbox"
                                      checked={!!colConfig.enabled}
                                      onChange={(e) => handleMaxValueChange(itemId, colKey, "enabled", e.target.checked)}
                                    />
                                    <span>{colKey}</span>
                                  </label>

                                  {colConfig.enabled && (
                                    <div style={{ marginTop: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                      <span style={{ fontSize: "0.7rem", color: "#b91c1c", fontWeight: "bold" }}>أقصى قيمة:</span>
                                      <input
                                        type="number"
                                        value={colConfig.max_value ?? ""}
                                        onChange={(e) => handleMaxValueChange(itemId, colKey, "max_value", e.target.value)}
                                        style={{ width: "65px", padding: "2px", fontSize: "0.75rem", border: "1px solid #ccc", borderRadius: "3px" }}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>لا توجد أصناف مجلوبة</span>
              )}
            </div>
            {selectedItemIds.length === 0 && (
              <span style={noteStyle}>🌐 ينطبق على جميع الأصناف (items: [])</span>
            )}
          </div>

          {/* أزرار الإجراءات */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px", borderTop: "1px solid #e5e7eb", paddingTop: "12px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{ backgroundColor: "#9ca3af", color: "#fff", border: "none", padding: "8px 16px", borderRadius: "6px", cursor: "pointer" }}
            >
              إلغاء
            </button>
            <button
              type="submit"
              style={{ backgroundColor: "#2563eb", color: "#fff", border: "none", padding: "8px 16px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
            >
              حفظ القيد
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// 🖥️ المكون الرئيسي: لوحة التحكم للقيود (Dashboard & CRUD Grid)
// ----------------------------------------------------------------------
export default function ColumnConstraintsManager({ branches = [], items = [] }) {
  const [constraints, setConstraints] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingConstraint, setEditingConstraint] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeToConstraints((data) => {
      setConstraints(data || []);
    });
    return () => unsubscribe();
  }, []);

  const handleCreate = () => {
    setEditingConstraint(null);
    setIsModalOpen(true);
  };

  const handleEdit = (constraint) => {
    setEditingConstraint(constraint);
    setIsModalOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm("هل أنت متأكد من مسح هذا القيد النهائي؟")) {
      await deleteConstraint(id);
    }
  };

  const getActionBadge = (action) => {
    switch (action) {
      case "lock":
        return { bg: "#fee2e2", color: "#b91c1c", label: "🔒 lock (قفل)" };
      case "default_value":
        return { bg: "#dbeafe", color: "#1d4ed8", label: "📌 default_value (قيمة افتراضية)" };
      case "max_value":
        return { bg: "#dcfce7", color: "#15803d", label: "⚡ max_value (حد أقصى)" };
      default:
        return { bg: "#f3f4f6", color: "#374151", label: action };
    }
  };

  return (
    <div style={{ padding: "24px", backgroundColor: "#f8fafc", minHeight: "100vh", direction: "rtl", textAlign: "right", fontFamily: "sans-serif" }}>
      {/* الهيدر والعنوان */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fff", padding: "20px 24px", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0, color: "#0f172a" }}>
            📊 لوحة تحكم قيود الهياكل (Inventory & Branch Rules Dashboard)
          </h1>
          <p style={{ margin: "4px 0 0 0", fontSize: "0.875rem", color: "#64748b" }}>
            إدارة مرنة ودقيقة لقواعد القفل، القيم الافتراضية، والحد الأقصى لكل منتج وفرع
          </p>
        </div>

        <button
          onClick={handleCreate}
          style={{
            backgroundColor: "#16a34a",
            color: "#fff",
            border: "none",
            padding: "10px 20px",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "bold",
            fontSize: "0.95rem",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
          }}
        >
          ➕ إضافة قيد جديد
        </button>
      </div>

      {/* جدول العرض CRUD Grid */}
      <div style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "right" }}>
          <thead>
            <tr style={{ backgroundColor: "#f1f5f9", borderBottom: "2px solid #e2e8f0", color: "#334155", fontSize: "0.875rem" }}>
              <th style={thStyle}>تسمية القيد والإجراء</th>
              <th style={thStyle}>التواريخ (dates)</th>
              <th style={thStyle}>الفروع (branchIds)</th>
              <th style={thStyle}>الأصناف والأعمدة (items & columns)</th>
              <th style={thStyle}>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {constraints.map((item) => {
              const badge = getActionBadge(item.action);
              return (
                <tr key={item.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                  {/* العنوان والنوع */}
                  <td style={tdStyle}>
                    <div style={{ fontWeight: "bold", fontSize: "1rem", color: "#0f172a", marginBottom: "4px" }}>
                      {item.name || item.title || "بدون عنوان"}
                    </div>
                    <span style={{ padding: "3px 8px", borderRadius: "4px", fontSize: "0.75rem", fontWeight: "bold", backgroundColor: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                  </td>

                  {/* التواريخ */}
                  <td style={tdStyle}>
                    {item.dates && item.dates.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {item.dates.map((d) => (
                          <span key={d} style={badgeStyle}>{d}</span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: "#2563eb", fontWeight: "bold", fontSize: "0.85rem" }}>🌐 الكل []</span>
                    )}
                  </td>

                  {/* الفروع */}
                  <td style={tdStyle}>
                    {item.branchIds && item.branchIds.length > 0 ? (
                      <span style={{ fontSize: "0.85rem" }}>{item.branchIds.join(", ")}</span>
                    ) : (
                      <span style={{ color: "#2563eb", fontWeight: "bold", fontSize: "0.85rem" }}>🌐 جميع الفروع []</span>
                    )}
                  </td>

                  {/* الأصناف والأعمدة */}
                  <td style={tdStyle}>
                    {item.items && item.items.length > 0 ? (
                      <div style={{ fontSize: "0.85rem", maxHeight: "110px", overflowY: "auto" }}>
                        {item.items.map((it, idx) => (
                          <div key={idx} style={{ marginBottom: "4px", backgroundColor: "#f8fafc", padding: "4px 8px", borderRadius: "4px" }}>
                            <strong>الصنف: {it.itemId}</strong>
                            <pre style={{ margin: "2px 0", fontSize: "0.75rem", color: "#475569" }}>
                              {JSON.stringify(it.columns)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: "#2563eb", fontWeight: "bold", fontSize: "0.85rem" }}>🌐 جميع الأصناف []</span>
                    )}
                  </td>

                  {/* زر التعديل والحذف */}
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => handleEdit(item)}
                        style={{ backgroundColor: "#f59e0b", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem", fontWeight: "bold" }}
                      >
                        تعديل
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        style={{ backgroundColor: "#ef4444", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem", fontWeight: "bold" }}
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {constraints.length === 0 && (
              <tr>
                <td colSpan="5" style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                  لا توجد قيود مسجلة حالياً في اللوحة.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* النافذة المنبثقة للنموذج */}
      <ConstraintFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        editingConstraint={editingConstraint}
        branches={branches}
        items={items}
      />
    </div>
  );
}

// ----------------------------------------------------------------------
// 🎨 الأنماط (Styles)
// ----------------------------------------------------------------------
const modalOverlayStyle = {
  position: "fixed",
  top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: "rgba(15, 23, 42, 0.65)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 1000,
  padding: "16px"
};

const modalContentStyle = {
  backgroundColor: "#fff",
  borderRadius: "12px",
  padding: "24px",
  width: "100%",
  maxWidth: "680px",
  maxHeight: "90vh",
  overflowY: "auto",
  direction: "rtl",
  textAlign: "right",
  boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)"
};

const labelStyle = {
  fontSize: "0.875rem",
  fontWeight: "bold",
  color: "#1e293b",
  marginBottom: "4px",
  display: "block"
};

const inputStyle = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: "6px",
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
  fontSize: "0.875rem"
};

const smallButtonStyle = {
  backgroundColor: "#e2e8f0",
  border: "none",
  color: "#334155",
  fontSize: "0.75rem",
  padding: "4px 8px",
  borderRadius: "4px",
  cursor: "pointer",
  fontWeight: "bold"
};

const scrollBoxStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  border: "1px solid #cbd5e1",
  padding: "8px",
  borderRadius: "6px",
  maxHeight: "150px",
  overflowY: "auto",
  backgroundColor: "#fafafa"
};

const checkboxLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  backgroundColor: "#fff",
  padding: "6px 10px",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "0.875rem",
  border: "1px solid #f1f5f9"
};

const badgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  backgroundColor: "#eff6ff",
  color: "#1d4ed8",
  padding: "2px 8px",
  borderRadius: "12px",
  fontSize: "0.75rem",
  border: "1px solid #bfdbfe"
};

const noteStyle = {
  fontSize: "0.75rem",
  color: "#2563eb",
  fontWeight: "bold",
  marginTop: "4px",
  display: "block"
};

const thStyle = {
  padding: "12px 16px"
};

const tdStyle = {
  padding: "12px 16px",
  verticalAlign: "top"
};