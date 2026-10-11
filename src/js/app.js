/**
 * @file Image Annotation Studio - standalone offline annotation engine.
 * @description
 * Core responsibilities:
 * - Decode and validate locally supplied images; preserve original-pixel geometry.
 * - Manage independent arrow, numbering and ROI layers with per-tool undo/redo.
 * - Draw the same annotations in browser preview and native-resolution exports.
 * - Export PNG with transparency or JPEG with selected compression and white matte.
 * - Persist original images, settings and histories in checked ZIP containers.
 * - Present English and German interface text from build-injected dictionaries.
 *
 * Architecture and invariants:
 * - All persistent geometry uses original-image pixels, never preview pixels.
 * - Selection handles belong to the editor and are never drawn into exports.
 * - File import validates the ZIP and image before mutating the existing project.
 * - No runtime HTTP requests, CDNs, fonts or external JavaScript are needed.
 *
 * Table of contents:
 * 01. Application state, localization and startup
 * 02. Layer navigation, visibility and history
 * 03. Source-image geometry and preview coordinates
 * 04. Shared canvas rendering and tool adornments
 * 05. Pointer hit testing, gestures and selection
 * 06. Settings schema, validation and dialog lifecycle
 * 07. Image loading, reset and file selection
 * 08. Full-resolution PNG and JPEG export
 * 09. ZIP archive writing, reading and integrity checks
 * 10. Project manifest validation and persistence
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/PROJECT_FORMAT.md
 * @see docs/SOURCE_GUIDE.md
 */
/**
 * @typedef {Object} ToolHistory
 * @property {Array<Object>} undo - Old tool snapshots, capped at 100 entries.
 * @property {Array<Object>} redo - States available for the inverse operation.
 */
/**
 * @typedef {Object} Histories
 * @property {ToolHistory} arrows - Arrow edit history.
 * @property {ToolHistory} numbering - Numbering edit history.
 * @property {ToolHistory} roi - Crop rectangle edit history.
 */
/**
 * @typedef {Object} AnnotationItems
 * @property {Array<Object>} arrows - Rotated arrow polygons.
 * @property {Array<Object>} numbering - Numbered circles in display order.
 * @property {Object|null} roi - Crop rectangle in original-image pixels.
 */
/**
 * @typedef {Object} StudioState
 * @property {boolean} loaded - Whether a valid image is active.
 * @property {HTMLImageElement|null} img - Decoded source image.
 * @property {'en'|'de'} lang - Current interface language.
 * @property {'arrows'|'numbering'|'roi'} active - Active tool.
 * @property {AnnotationItems} items - Persistent annotations.
 * @property {Histories} hist - Independent tool histories.
 * @property {Object<string,boolean>} visible - Layer visibility flags.
 * @property {Array<string>} front - Back/front order for the drawing layers.
 * @property {boolean} dirty - Unsaved change warning state.
 * @property {string} jpegCompression - Compression preference: low/medium/high.
 */
'use strict';
// Image coordinates are ALWAYS stored in original pixels. Preview and export share a renderer.
/** @type {(id:string) => HTMLElement} Resolve a required DOM element by ID. */
const $=id=>document.getElementById(id);
/** Deep-clone JSON-safe annotation state; snapshots intentionally have no DOM nodes. @param {Object} value @returns {Object} */
const clone=value=>JSON.parse(JSON.stringify(value));
/** Restrict a scalar to inclusive bounds. @param {number} x @param {number} a @param {number} b @returns {number} */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const defaults=__STUDIO_DEFAULTS__;
const defaultPalette=__STUDIO_PALETTE__;
const names={numbering:'Numbering',arrows:'Arrows',roi:'ROI'};
/** JPEG encoder quality values by compression level (lower compression means higher quality). */
const JPEG_QUALITY=Object.freeze(__STUDIO_JPEG_QUALITIES__);
const DEFAULT_JPEG_COMPRESSION=__STUDIO_JPEG_DEFAULT__;
/** @type {StudioState} Mutable single-session editor state; serialized subsets go into project ZIPs. */
const state={loaded:false,img:null,sourceFile:null,name:'',palette:clone(defaultPalette),front:['arrows','numbering'],active:'arrows',visible:{arrows:true,numbering:true,roi:true},items:{arrows:[],numbering:[],roi:null},settings:clone(defaults),preferred:{arrows:1,numbering:1},ctrl:false,selection:{arrows:-1,numbering:-1},hist:{arrows:{undo:[],redo:[]},numbering:{undo:[],redo:[]},roi:{undo:[],redo:[]}},jpegCompression:DEFAULT_JPEG_COMPRESSION,dirty:false,view:'full',scale:1,window:{x:0,y:0,w:1,h:1},pointer:null,hover:null,lang:'en'};
// Release safety: prevent silent loss of an unsaved working state.
let toastTimer=0,saveRevision=0;
/**
 * ==========================================================================
 * 01. Application state, localization and startup
 * ==========================================================================
 */
/**
 * Mark the currently loaded project as modified.
 *
 * @description Increments saveRevision for async save race protection; no change is recorded before an image is loaded.
 */
function markDirty(){if(state.loaded){state.dirty=true;saveRevision++;}}
window.addEventListener('beforeunload',event=>{
 if(!state.loaded||!state.dirty)return;
 event.preventDefault();
 event.returnValue=''; // Browser owns the confirmation wording.
});
// Conservative limits: browsers have different canvas and memory capacities.
const MAX_IMAGE_BYTES=__STUDIO_MAX_IMAGE_BYTES__;
const MAX_IMAGE_SIDE=__STUDIO_MAX_IMAGE_SIDE__;
const MAX_IMAGE_PIXELS=__STUDIO_MAX_IMAGE_PIXELS__;
const MAX_PREVIEW_SIDE=__STUDIO_MAX_PREVIEW_SIDE__;
const MAX_PREVIEW_PIXELS=__STUDIO_MAX_PREVIEW_PIXELS__;
const MAX_EXPORT_PIXELS=__STUDIO_MAX_EXPORT_PIXELS__;
/**
 * Reject images that exceed the application's validated loading limits.
 *
 * @description Requires positive safe-integer dimensions and file size; checks maximum side length, total pixels and encoded bytes. The caller handles localized error reporting.
 * @param {number} width - Intrinsic width in pixels.
 * @param {number} height - Intrinsic height in pixels.
 * @param {number} bytes - Encoded file size in bytes.
 * @returns {void} No value is returned on success.
 * @throws {Error} When the candidate fails validation or exceeds supported limits.
 *
 * <br><b>Validation order:</b>
 * Require positive safe integers, then reject source dimensions above MAX_IMAGE_SIDE / MAX_IMAGE_PIXELS. Finally enforce MAX_IMAGE_BYTES before decoding.
 */
function checkImageSize(width,height,bytes){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw new Error('Invalid image dimensions');
 if(width>MAX_IMAGE_SIDE||height>MAX_IMAGE_SIDE||width*height>MAX_IMAGE_PIXELS)throw new Error('Image dimensions exceed supported limits');
 if(!Number.isSafeInteger(bytes)||bytes<1||bytes>MAX_IMAGE_BYTES)throw new Error('Image file exceeds 65 MB limit');
}
/**
 * Convert an image-loading exception into a localized user message.
 *
 * @description Size and canvas-allocation failures map to imageTooLarge; all other failures use notSupported. Internal details are not exposed in the toast.
 * @param {Error} err - Original error raised during image preparation.
 * @returns {string} Generated text or localized UI label.
 */
function imageFailureMessage(err){
 if(/dimensions|limit|large|exceed|size|bytes|memory|canvas/i.test(String(err?.message||'')))return t('imageTooLarge');
 return t('notSupported');
}

/**
 * Display a transient application status message.
 *
 * @description Writes to the live region and restarts the 2.9-second hide timer, so consecutive messages do not overlap.
 * @param {string} msg - Already localized status text.
 */
function toast(msg){$('status').textContent=msg;$('status').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('status').classList.remove('show'),2900);}
const translations=__STUDIO_TRANSLATIONS__;
/**
 * Resolve a translation key using the currently selected language.
 *
 * @description The key itself is the fallback when no translation exists. Translation dictionaries are injected at build time.
 * @param {string} k - Translation dictionary key.
 * @returns {string} Generated text or localized UI label.
 */
function t(k){return translations[state.lang][k]||k}
/**
 * Apply the selected language across the complete UI.
 *
 * @description Refreshes data-t labels, programmatic button text, language accessibility state, layer cards, tool help, settings tabs and export filename.
 */
function refreshLanguage(){document.documentElement.lang=state.lang;document.querySelectorAll('[data-t]').forEach(e=>e.textContent=t(e.dataset.t));$('newProjectButton').textContent=t('newProject');$('settingsButton').textContent=t('settings');$('standardBtn').textContent=t('standard');$('invertedBtn').textContent=t('inverted');$('undoBtn').textContent=t('undo');$('redoBtn').textContent=t('redo');syncLanguagePicker();if($('settingsPopup').style.display==='block')renderSettingsTabs();drawCards();refreshToolbar();updateFilename();}
$('languageSelect').addEventListener('change',e=>{if(!['de','en'].includes(e.target.value))return;if(state.lang!==e.target.value)markDirty();state.lang=e.target.value;refreshLanguage();});
/**
 * Synchronize the visible and hidden language selection controls.
 *
 * @description Updates the compact language button, backing select value and aria-selected attributes of both language options.
 */
function syncLanguagePicker(){$('languageSelect').value=state.lang;$('languageToggle').firstChild.textContent=state.lang.toUpperCase()+' ';for(const option of $('languageMenu').querySelectorAll('[data-language]'))option.setAttribute('aria-selected',String(option.dataset.language===state.lang));}
/**
 * Close the accessible language menu.
 *
 * @description Keeps aria-expanded synchronized with the menu hidden state.
 */
function closeLanguageMenu(){$('languageMenu').hidden=true;$('languageToggle').setAttribute('aria-expanded','false');}
/**
 * Open the accessible language menu and focus the current option.
 *
 * @description Focus is placed on the selected entry to support immediate keyboard navigation.
 */
function openLanguageMenu(){$('languageMenu').hidden=false;$('languageToggle').setAttribute('aria-expanded','true');$('languageMenu').querySelector(`[data-language="${state.lang}"]`).focus();}
$('languageToggle').addEventListener('click',()=>{$('languageMenu').hidden?openLanguageMenu():closeLanguageMenu();});
$('languageMenu').addEventListener('click',e=>{const button=e.target.closest('[data-language]');if(!button)return;$('languageSelect').value=button.dataset.language;$('languageSelect').dispatchEvent(new Event('change',{bubbles:true}));closeLanguageMenu();$('languageToggle').focus();});
$('languageMenu').addEventListener('keydown',e=>{const options=[...$('languageMenu').querySelectorAll('[data-language]')],idx=options.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();closeLanguageMenu();$('languageToggle').focus();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();options[(idx+(e.key==='ArrowDown'?1:options.length-1))%options.length].focus();}else if(e.key==='Home'||e.key==='End'){e.preventDefault();options[e.key==='Home'?0:options.length-1].focus();}});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#languagePicker'))closeLanguageMenu();});
$('languageToggle').addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();openLanguageMenu();}});

/**
 * ==========================================================================
 * 02. Layer navigation, visibility and history
 * ==========================================================================
 */
/**
 * Determine whether a usable region-of-interest rectangle exists.
 *
 * @description Requires a stored ROI whose width and height exceed one original-image pixel.
 * @returns {boolean} Whether the requested condition is valid.
 */
function hasRoi(){const r=state.items.roi;return !!(r&&r.w>1&&r.h>1)}
const NUMBER_LAYER_ICON='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="currentColor"/><text x="12" y="16" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#ffffff">1</text></svg>';
const ARROW_LAYER_ICON='<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true" focusable="false" style="transform:rotate(90deg);transform-origin:center;"><path d="M320-120v-320H120l360-440 360 440H640v320H320Z"/></svg>';
const ROI_LAYER_ICON='<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true" focusable="false"><path d="M200-80q-50 0-85-35t-35-85q0-39 22.5-69.5T160-313v-334q-35-13-57.5-43.5T80-760q0-50 35-85t85-35q39 0 69.5 22.5T313-800h334q12-35 42.5-57.5T760-880q50 0 85 35t35 85q0 40-22.5 70.5T800-647v334q35 13 57.5 43.5T880-200q0 50-35 85t-85 35q-39 0-69.5-22.5T647-160H313q-13 35-43.5 57.5T200-80Zm113-160h334q9-26 28-45t45-28v-334q-26-9-45-28t-28-45H313q-9 26-28 45t-45 28v334q26 9 45 28t28 45Z"/></svg>';
const EYE_OPEN='<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="48 -912 864 864" width="18px" fill="currentColor" aria-hidden="true" focusable="false"><path d="M599-361q49-49 49-119t-49-119q-49-49-119-49t-119 49q-49 49-49 119t49 119q49 49 119 49t119-49Zm-187-51q-28-28-28-68t28-68q28-28 68-28t68 28q28 28 28 68t-28 68q-28 28-68 28t-68-28ZM220-270.5Q103-349 48-480q55-131 172-209.5T480-768q143 0 260 78.5T912-480q-55 131-172 209.5T480-192q-143 0-260-78.5ZM480-480Zm207 158q95-58 146-158-51-100-146-158t-207-58q-112 0-207 58T127-480q51 100 146 158t207 58q112 0 207-58Z"/></svg>';
const EYE_CLOSED='<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="48 -912 864 864" width="18px" fill="currentColor" aria-hidden="true" focusable="false"><path d="m637-425-62-62q4-38-23-65.5T487-576l-62-62q13-5 27-7.5t28-2.5q70 0 119 49t49 119q0 14-2.5 28t-8.5 27Zm133 133-52-52q36-28 65.5-61.5T833-480q-49-101-144.5-158.5T480-696q-26 0-51 3t-49 10l-58-58q38-15 77.5-21t80.5-6q143 0 261.5 77.5T912-480q-22 57-58.5 103.5T770-292Zm-2 202L638-220q-38 14-77.5 21t-80.5 7q-143 0-261.5-77.5T48-480q22-57 58-104t84-85L90-769l51-51 678 679-51 51ZM241-617q-35 28-65 61.5T127-480q49 101 144.5 158.5T480-264q26 0 51-3.5t50-9.5l-45-45q-14 5-28 7.5t-28 2.5q-70 0-119-49t-49-119q0-14 3.5-28t6.5-28l-81-81Zm287 89Zm-96 96Z"/></svg>';
const RESET_ICON='<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="48 -912 864 864" width="18px" fill="currentColor" aria-hidden="true" focusable="false"><path d="M480-192q-120 0-204-84t-84-204q0-120 84-204t204-84q65 0 120.5 27t95.5 72v-99h72v240H528v-72h131q-29-44-76-70t-103-26q-90 0-153 63t-63 153q0 90 63 153t153 63q84 0 144-55.5T693-456h74q-9 112-91 188t-196 76Z"/></svg>';
const SWAP_ICON='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3-4 4 4 4"/><path d="M4 7h15"/><path d="m16 21 4-4-4-4"/><path d="M20 17H5"/></svg>';
/**
 * Create the markup for one tool-layer card.
 *
 * @description Includes translated title, active and visible states, clearing action and front/back or independent position label.
 * @param {string} id - Tool identifier: arrows, numbering or roi.
 * @param {number} orderIndex - Drawing order index, zero is front.
 * @returns {string} Generated text or localized UI label.
 */
function cardHtml(id,orderIndex){const v=state.visible[id],active=state.active===id,pos=id==='roi'?t('independent'):(orderIndex===0?t('front'):t('back'));
const icon=id==='numbering'?NUMBER_LAYER_ICON:id==='arrows'?ARROW_LAYER_ICON:ROI_LAYER_ICON;
const hasContent=id==='roi'?hasRoi():state.items[id].length>0;
return `<div role="button" tabindex="0" aria-pressed="${active}" data-layer="${id}" class="tool-card ${active?'active':''} ${v?'':'hidden-layer'}" aria-label="${t(id)}, ${pos}, ${v?t('visible'):t('hidden')}"><div class="tool-top"><button type="button" class="card-reset" data-reset="${id}" aria-label="${t('resetLayer')}: ${t(id)}" title="${t('resetLayer')}" ${hasContent?'':'disabled'}>${RESET_ICON}</button><button class="eye-btn" aria-label="${v?t('hidden'):t('visible')} ${t(id)}" aria-pressed="${v}" type="button" data-eye="${id}" title="${v?t('visible'):t('hidden')}">${v?EYE_OPEN:EYE_CLOSED}</button></div><span class="tool-icon">${icon}</span><span class="tool-title">${t(id)}</span><span class="tool-position">${pos}</span></div>`;}
/**
 * Regenerate the layer navigation using the current editor state.
 *
 * @description Drawing layers follow the front ordering; ROI is shown separately and remains independent of swaps.
 */
function drawCards(){$('layerCards').innerHTML=`<div id="drawingGroup">${cardHtml(state.front[0],0)}<button id="swapLayers" type="button" aria-label="${t('swapLayers')}" title="${t('swapLayers')}">${SWAP_ICON}</button>${cardHtml(state.front[1],1)}</div><div id="roiSeparator" aria-hidden="true"></div><div id="roiCardSlot">${cardHtml('roi',2)}</div>`;}
/**
 * Activate an annotation tool without modifying its annotations.
 *
 * @description Clears in-progress pointer and hover state, refreshes controls, and repaints the preview.
 * @param {string} id - Tool identifier: arrows, numbering or roi.
 */
function chooseLayer(id){if(!names[id])return;if(state.active!==id)markDirty();state.active=id;state.pointer=null;state.hover=null;drawCards();refreshToolbar();paint();}
/**
 * Toggle a layer's visibility without creating a tool-history entry.
 *
 * @description A hidden ROI invalidates crop view and cropped export; the viewer and availability controls are updated.
 * @param {string} id - Tool identifier: arrows, numbering or roi.
 */
function toggleVisible(id){markDirty();state.visible[id]=!state.visible[id];if(id==='roi'){const wasCrop=state.view==='crop';updateROIOptions();if(wasCrop&&state.view==='full')resizePreview();}drawCards();refreshToolbar();paint();}
/**
 * Swap the two drawing layers while leaving ROI independent.
 *
 * @description Changing z-order marks the project dirty but does not create an annotation undo entry.
 */
function reorder(){markDirty();state.front.reverse();drawCards();paint();}
/**
 * Remove the annotations of one tool as a single undoable operation.
 *
 * @description Captures the previous items/settings snapshot; clearing ROI also disables crop view and related export options.
 * @param {string} id - Tool identifier: arrows, numbering or roi.
 */
function clearLayer(id){if(!state.loaded||!names[id])return;const before=capture(id);state.items[id]=id==='roi'?null:[];state.selection[id]=-1;record(id,before);if(id==='roi'){setView('full');updateROIOptions();}drawCards();paint();toast(t('empty'));}
$('layerCards').addEventListener('click',e=>{if(e.target.closest('#swapLayers')){reorder();return;}const reset=e.target.closest('[data-reset]');if(reset){clearLayer(reset.dataset.reset);return;}const eye=e.target.closest('[data-eye]');if(eye){toggleVisible(eye.dataset.eye);return;}const card=e.target.closest('[data-layer]');if(card)chooseLayer(card.dataset.layer);});
$('layerCards').addEventListener('keydown',e=>{if(e.target.closest('button'))return;const card=e.target.closest('[data-layer]');if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();chooseLayer(card.dataset.layer);}});
/**
 * Return Standard or Inverted drawing style for the selected tool.
 *
 * @description Holding Ctrl temporarily reverses the stored style rather than changing the preference.
 * @param {string} id - Tool identifier: arrows, numbering or roi.
 * @returns {number} Computed numeric value in image coordinate space.
 */
function effectiveStyle(id){return state.ctrl?3-state.preferred[id]:state.preferred[id]}
/**
 * Synchronize mode, undo/redo and contextual help controls.
 *
 * @description Mode buttons are disabled for ROI; history availability is evaluated per active tool.
 */
function refreshToolbar(){const id=state.active,roi=id==='roi';$('modeGroup').classList.toggle('roi-mode',roi);$('standardBtn').classList.toggle('mode-active',!roi&&effectiveStyle(id)===1);$('invertedBtn').classList.toggle('mode-active',!roi&&effectiveStyle(id)===2);$('standardBtn').setAttribute('aria-pressed',String(!roi&&effectiveStyle(id)===1));$('invertedBtn').setAttribute('aria-pressed',String(!roi&&effectiveStyle(id)===2));const h=state.hist[id];$('undoBtn').disabled=!h.undo.length;$('redoBtn').disabled=!h.redo.length;$('activeDescription').textContent=!state.visible[id]?t('hiddenEditing'):(roi&&state.view==='crop'?t('roiViewNote'):t('edit'+id[0].toUpperCase()+id.slice(1)));}
$('standardBtn').onclick=()=>{if(state.active==='roi')return;if(state.preferred[state.active]!==1)markDirty();state.preferred[state.active]=1;refreshToolbar();};
$('invertedBtn').onclick=()=>{if(state.active==='roi')return;if(state.preferred[state.active]!==2)markDirty();state.preferred[state.active]=2;refreshToolbar();};
/**
 * Snapshot one tool's annotations and numerical settings.
 *
 * @description Snapshots are JSON-deep-cloned and are independent from layer visibility or ordering.
 * @param {string} id - Tool identifier: arrows, numbering or roi.
 * @returns {Object} Result of the operation.
 */
function capture(id){return clone({items:state.items[id],settings:state.settings[id]});}
/**
 * Restore a previously captured tool-history snapshot.
 *
 * @description Selection and hover are cleared; ROI restoration recalculates crop availability and preview dimensions.
 * @param {string} id - Tool identifier: arrows, numbering or roi.
 * @param {Object} snap - Validated tool snapshot to restore.
 */
function restore(id,snap){state.items[id]=clone(snap.items);state.settings[id]=clone(snap.settings);state.selection[id]=-1;state.hover=null;if(id==='roi'){updateROIOptions();resizePreview();}else paint();}
/**
 * Commit a changed tool snapshot to its bounded undo history.
 *
 * @description Identical snapshots are ignored; history is limited to 100 entries and a new commit clears the redo branch.
 * @param {string} id - Tool identifier: arrows, numbering or roi.
 * @param {Object} before - Captured pre-edit snapshot.
 *
 * <br><b>History contract:</b>
 * Compare the captured state with the live tool snapshot. Store only actual changes and clear that tool's redo history. Visibility and layer ordering are not stored as tool history.
 */
function record(id,before){if(JSON.stringify(before)===JSON.stringify(capture(id)))return;let h=state.hist[id];h.undo.push(before);if(h.undo.length>100)h.undo.shift();h.redo.length=0;markDirty();drawCards();refreshToolbar();}
/**
 * Undo the latest edit belonging to the active annotation tool.
 *
 * @description The current state is placed on that tool's redo stack before restoring the preceding snapshot.
 */
function undo(){const id=state.active,h=state.hist[id];if(!h.undo.length)return;markDirty();h.redo.push(capture(id));restore(id,h.undo.pop());drawCards();refreshToolbar();}
/**
 * Redo the active tool's most recently undone edit.
 *
 * @description The current state returns to the undo stack; histories for other tools are untouched.
 */
function redo(){const id=state.active,h=state.hist[id];if(!h.redo.length)return;markDirty();h.undo.push(capture(id));restore(id,h.redo.pop());drawCards();refreshToolbar();}
$('undoBtn').onclick=undo;$('redoBtn').onclick=redo;
/**
 * Delete the current annotation or ROI and preserve undo semantics.
 *
 * @description When deleting a numbered circle, remaining labels are renumbered sequentially.
 */
function deleteSelected(){const id=state.active;if(id==='roi'){if(!hasRoi())return;let before=capture(id);state.items.roi=null;record(id,before);if(state.view==='crop')setView('full');updateROIOptions();paint();return;}let ix=state.selection[id];if(ix<0)return;let before=capture(id);state.items[id].splice(ix,1);state.selection[id]=-1;if(id==='numbering')state.items.numbering.forEach((c,i)=>c.number=i+1);record(id,before);drawCards();paint();}
/**
 * Detect whether a keyboard event originates in a text-editing control.
 *
 * @description Shortcuts must not intercept typing in inputs, selects, textareas or contenteditable elements.
 * @param {Element} target - Event target element.
 * @returns {boolean} Whether the requested condition is valid.
 */
function editingTarget(target){return target.closest('input,select,textarea,[contenteditable="true"]')!==null;}
document.addEventListener('keydown',e=>{if(e.key==='Control'){if(!state.ctrl){state.ctrl=true;refreshToolbar();}return;}if(editingTarget(e.target)||$('settingsPopup').style.display==='block')return;const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();if(mod&&!e.altKey&&(k==='z'||k==='y')){if(k==='z'&&!e.shiftKey)undo();else if((k==='z'&&e.shiftKey)||(k==='y'&&!e.shiftKey))redo();e.preventDefault();return;}if(!mod&&!e.altKey&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();deleteSelected();}});
document.addEventListener('keyup',e=>{if(e.key==='Control'){state.ctrl=false;refreshToolbar();}});
window.addEventListener('blur',()=>{state.ctrl=false;refreshToolbar();cancelPointer();});document.addEventListener('visibilitychange',()=>{if(document.hidden){state.ctrl=false;refreshToolbar();cancelPointer();}});
const canvas=$('canvas'),ctx=canvas.getContext('2d');
/**
 * ==========================================================================
 * 03. Source-image geometry and preview coordinates
 * ==========================================================================
 */
/**
 * Read the source image's intrinsic dimensions.
 *
 * @description Annotation coordinates and export geometry always use these pixels, never preview CSS dimensions.
 * @returns {{w:number,h:number}} Result of the operation.
 */
function imageDims(){return {w:state.img.naturalWidth,h:state.img.naturalHeight};}
/**
 * Clamp the ROI to actual image bounds and return its intersection.
 *
 * @description Rejects absent or degenerate rectangles; does not modify the stored ROI.
 * @returns {Object|null} Result of the operation.
 */
function validRoi(){if(!hasRoi())return null;const r=state.items.roi,{w,h}=imageDims(),x=clamp(r.x,0,w),y=clamp(r.y,0,h),right=clamp(r.x+r.w,0,w),bottom=clamp(r.y+r.h,0,h);return right-x>=1&&bottom-y>=1?{x,y,w:right-x,h:bottom-y}:null;}
/**
 * Return the intrinsic-pixel window currently shown in the canvas.
 *
 * @description Full view uses all source pixels; crop view uses the validated ROI with a safe full-image fallback.
 * @returns {Object} Result of the operation.
 */
function viewWindow(){if(state.view==='crop'){return validRoi()||{x:0,y:0,...imageDims()};}return {x:0,y:0,...imageDims()};}
/**
 * Fit the selected image window into the browser preview canvas.
 *
 * @description Enforces viewport and preview-pixel limits while preserving original image coordinates for all annotations.
 *
 * <br><b>Scaling strategy:</b>
 * The display scale is the minimum of 1, available viewport width/height, configured preview side limit and square-root pixel-budget constraint. Neither original image nor annotation geometry is resized.
 */
function resizePreview(){if(!state.loaded)return;state.window=viewWindow();let win=state.window,limitW=Math.min(Math.max(260,$('canvasScroll').clientWidth-42),Math.max(320,window.innerWidth*.88)),limitH=Math.max(260,Math.round(window.innerHeight*.72));state.scale=Math.min(1,limitW/win.w,limitH/win.h,MAX_PREVIEW_SIDE/win.w,MAX_PREVIEW_SIDE/win.h,Math.sqrt(MAX_PREVIEW_PIXELS/(win.w*win.h)));if(!Number.isFinite(state.scale)||state.scale<=0)throw new Error('Preview exceeds canvas limits');canvas.width=Math.max(1,Math.round(win.w*state.scale));canvas.height=Math.max(1,Math.round(win.h*state.scale));paint();$('scaleFactorDisplay').textContent=Math.round(state.scale*100)+'%';}
window.addEventListener('resize',()=>{if(state.loaded)resizePreview();});
/**
 * Translate a pointer event from CSS canvas coordinates to source-image pixels.
 *
 * @description Accounts for element position, rendered width/height and the active crop viewport.
 * @param {PointerEvent} e - Pointer event on the editor canvas.
 * @returns {{x:number,y:number}} Result of the operation.
 *
 * <br><b>Coordinate transform:</b>
 * Read the canvas DOM rectangle, normalize pointer coordinates within it, then map to the original-pixel view window. This transformation also applies inside ROI-only view.
 */
function pointerPos(e){const r=canvas.getBoundingClientRect();return {x:state.window.x+(e.clientX-r.left)*state.window.w/r.width,y:state.window.y+(e.clientY-r.top)*state.window.h/r.height};}
/**
 * Change between full-image and ROI-only preview modes.
 *
 * @description Crop mode is permitted only for a visible, valid ROI; the preview is resized after changing the viewport.
 * @param {string} value - Requested view mode (full or crop).
 */
function setView(value){const next=value==='crop'&&state.visible.roi&&validRoi()?'crop':'full';if(next!==state.view)markDirty();state.view=next;document.querySelector('input[name=view][value="'+state.view+'"]').checked=true;resizePreview();refreshToolbar();}
/**
 * Enable or disable view/export controls depending on ROI validity.
 *
 * @description Invalid or hidden ROI forces full view and full-image export and disables border selection.
 */
function updateROIOptions(){const yes=state.visible.roi&&!!validRoi();$('exportCropOption').hidden=!yes;$('exportBorderOption').hidden=!yes;$('viewCrop').disabled=!yes;$('exportCrop').disabled=!yes;if(!yes){$('viewCrop').checked=false;document.querySelector('input[name="view"][value="full"]').checked=true;$('exportCrop').checked=false;document.querySelector('input[name="exportScope"][value="full"]').checked=true;$('borderCheckboxROI').checked=false;state.view='full';}updateExportBorder();updateFilename();}
/**
 * Set ROI-border checkbox availability for the current export scope.
 *
 * @description Borders are meaningful only when cropped export is selected and the ROI is visible and valid.
 */
function updateExportBorder(){$('borderCheckboxROI').disabled=!$('exportCrop').checked||!state.visible.roi||!validRoi();}
for(const radio of document.querySelectorAll('input[name=view]'))radio.addEventListener('change',e=>{if(e.target.checked)setView(e.target.value);});
for(const radio of document.querySelectorAll('input[name=exportScope]'))radio.addEventListener('change',()=>{markDirty();updateExportBorder();updateFilename();});
$('timestampCheckbox').addEventListener('change',()=>{markDirty();updateFilename();});
$('borderCheckboxROI').addEventListener('change',markDirty);
/**
 * Format a local-time suffix safe for filenames.
 *
 * @description Uses YYYY-MM-DD_HH-MM-SS from the local clock so generated file names are portable on Windows.
 * @param {Date} at - Local date/time to format (defaults to the current instant).
 * @returns {string} Generated text or localized UI label.
 */
function timestamp(at=new Date()){const d=at,p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;}
/**
 * Compute the exported filename from source name and selected scope.
 *
 * @description Adds _annotated or _roi, optional timestamp and the supplied extension; strips directory separators and control characters.
 * @param {string} extension - Filename suffix without a leading dot.
 * @returns {string} Generated text or localized UI label.
 */
function filename(extension='png'){const base=(state.name.replace(/\.[^.]*$/,'')||'edited-image').replace(/[\\/\u0000-\u001f]/g,'_');const suffix=$('exportCrop').checked?'_roi':'_annotated';return base+suffix+($('timestampCheckbox').checked?'_'+timestamp():'')+'.'+extension;}
/**
 * Update the filename preview shown above export controls.
 *
 * @description The label is blank until an image has been loaded.
 */
function updateFilename(){$('exportName').textContent=state.loaded?filename():'';}
/**
 * ==========================================================================
 * 04. Shared canvas rendering and tool adornments
 * ==========================================================================
 */
/**
 * Convert a hex color and opacity to a canvas rgba() string.
 *
 * @description Supports 3- and 6-character hexadecimal values for translucent ROI overlays.
 * @param {string} hex - Hex RGB color.
 * @param {number} opacity - Opacity between zero and one.
 * @returns {string} Generated text or localized UI label.
 */
function colorWithAlpha(hex,opacity){let s=hex.replace('#','');if(s.length===3)s=s.split('').map(x=>x+x).join('');return `rgba(${parseInt(s.slice(0,2),16)},${parseInt(s.slice(2,4),16)},${parseInt(s.slice(4,6),16)},${opacity})`;}
// All shapes are drawn in original-image coordinates; the context transform maps to preview/export.
/**
 * Draw one numbered annotation using intrinsic-image coordinates.
 *
 * @description Centers the label using measured glyph bounds and uses the stored Normal/Inverted palette.
 * @param {CanvasRenderingContext2D} context - Rendering canvas 2D context.
 * @param {Object} c - Stored numbered circle annotation.
 *
 * <br><b>Label centering:</b>
 * Use Canvas 2D text metrics for actual left/right/ascent/descent, not an approximate character-width offset. This accommodates single- and multi-digit labels.
 */
function circleDraw(context,c){const cfg=state.settings.numbering;context.beginPath();context.arc(c.x,c.y,c.radius,0,Math.PI*2);context.fillStyle=c.style===1?state.palette.standardFill:state.palette.invertedFill;context.fill();context.strokeStyle=c.style===1?state.palette.standardStroke:state.palette.invertedStroke;context.lineWidth=c.strokeWidth;context.stroke();context.font=`bold ${cfg.fontSize/state.baseScale}px Arial,sans-serif`;context.textAlign='left';context.textBaseline='alphabetic';const label=String(c.number),m=context.measureText(label);const left=m.actualBoundingBoxLeft,right=m.actualBoundingBoxRight,asc=m.actualBoundingBoxAscent,desc=m.actualBoundingBoxDescent;const dx=Number.isFinite(left+right)?(left-right)/2:-m.width/2,dy=Number.isFinite(asc+desc)?(asc-desc)/2:0;context.fillStyle=c.style===1?state.palette.standardText:state.palette.invertedText;context.fillText(label,c.x+dx,c.y+dy);}
/**
 * Draw an editable arrow as a filled polygon with outline.
 *
 * @description Applies translation and rotation to the canvas context; width, height, tail and head are original-image units.
 * @param {CanvasRenderingContext2D} context - Rendering canvas 2D context.
 * @param {Object} a - Stored arrow annotation.
 *
 * <br><b>Geometry:</b>
 * Build a normalized seven-point polygon using arrow tail and head fractions. Rotate the local geometry around the annotation center and restore the drawing context afterwards.
 */
function arrowDraw(context,a){context.save();context.translate(a.x,a.y);context.rotate(a.angle);const w=a.w,h=a.h,tail=a.tail,head=a.head,top=.5-tail/2,bot=.5+tail/2,base=1-head;const poly=[[0,top],[base,top],[base,0],[1,.5],[base,1],[base,bot],[0,bot]];context.beginPath();poly.forEach(([x,y],i)=>{const xx=(x-.5)*w,yy=(y-.5)*h;if(!i)context.moveTo(xx,yy);else context.lineTo(xx,yy);});context.closePath();context.fillStyle=a.style===1?state.palette.standardFill:state.palette.invertedFill;context.fill();context.lineWidth=state.settings.arrows.stroke/state.baseScale;context.strokeStyle=a.style===1?state.palette.standardStroke:state.palette.invertedStroke;context.stroke();context.restore();}
/**
 * Start a rounded-rectangle path with a safe corner radius.
 *
 * @description Clamps radius to half the smaller side to avoid impossible corner geometry.
 * @param {CanvasRenderingContext2D} context - Rendering canvas 2D context.
 * @param {number} x - Horizontal coordinate or number.
 * @param {number} y - Vertical coordinate or number.
 * @param {number} w - Width in pixels.
 * @param {number} h - Height in pixels.
 * @param {number} r - Corner radius in pixels.
 */
function roundedPath(context,x,y,w,h,r){const rr=clamp(r,0,Math.min(w,h)/2);context.beginPath();context.roundRect(x,y,w,h,rr);}
/**
 * Draw ROI boundary and dim the pixels outside it.
 *
 * @description Uses an even-odd fill for the surrounding overlay; deliberately omits the overlay in cropped exports.
 * @param {CanvasRenderingContext2D} context - Rendering canvas 2D context.
 * @param {Object} roi - Stored ROI geometry in source-image pixels.
 * @param {boolean} preview - Whether rendering the interactive preview.
 * @param {boolean} cropped - Whether drawing into a cropped image.
 *
 * <br><b>Even-odd overlay:</b>
 * Dim the surrounding image without filling the selection rectangle itself. Apply a rounded outline, and suppress the overlay when exporting the selected crop.
 */
function roiDraw(context,roi,preview=false,cropped=false){if(!roi||cropped||!state.visible.roi)return;const cfg=state.settings.roi,{w,h}=imageDims();context.save();context.beginPath();context.rect(0,0,w,h);context.roundRect(roi.x,roi.y,roi.w,roi.h,clamp(cfg.borderRadius/state.baseScale,0,Math.min(roi.w,roi.h)/2));context.fillStyle=colorWithAlpha(state.palette.roiOverlayColor,cfg.overlayAlpha);context.fill('evenodd');roundedPath(context,roi.x,roi.y,roi.w,roi.h,cfg.borderRadius/state.baseScale);context.strokeStyle=state.palette.standardStroke;context.lineWidth=cfg.border/state.baseScale;context.stroke();context.restore();}
/**
 * Render editor-only selection handles and hover feedback.
 *
 * @description Draws arrow resize/rotation handles, circle outlines and ROI edge/corner handles; none are part of final image exports.
 * @param {CanvasRenderingContext2D} context - Rendering canvas 2D context.
 */
function selectionDraw(context){const active=state.active,s=state.scale;if(!state.visible[active])return;if(active==='arrows'){const arrow=state.items.arrows[state.selection.arrows];if(!arrow)return;context.save();context.translate(arrow.x,arrow.y);context.rotate(arrow.angle);for(let i=0;i<4;i++){const xx=(i===0||i===3?-1:1)*arrow.w/2,yy=(i<2?-1:1)*arrow.h/2,h=10/s;context.fillStyle=state.hover?.kind==='corner'&&state.hover.index===i?'#111B42':state.palette.handle;context.fillRect(xx-h/2,yy-h/2,h,h);}context.restore();}
else if(active==='numbering'){const c=state.items.numbering[state.selection.numbering];if(!c)return;context.beginPath();context.arc(c.x,c.y,c.radius+4/s,0,2*Math.PI);context.setLineDash([3/s,3/s]);context.lineWidth=1/s;context.strokeStyle='#111b42';context.stroke();context.setLineDash([]);}
else{const r=validRoi();if(!r||state.view==='crop')return;context.save();const points=[[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]];
// Visual interaction feedback (preview only): one edge when dragged, two edges at a corner.
const roiInteraction=state.pointer?.layer==='roi'?state.pointer:state.hover;
if(roiInteraction&&(roiInteraction.kind==='roi-edge'||roiInteraction.kind==='roi-corner')){
 const chosen=roiInteraction.kind==='roi-edge'?[roiInteraction.index]:[[0,3],[0,1],[1,2],[2,3]][roiInteraction.index];
 context.beginPath();for(const edge of chosen){const [ax,ay]=points[edge], [bx,by]=points[(edge+1)%4];context.moveTo(ax,ay);context.lineTo(bx,by);}
 context.lineWidth=6/s;context.strokeStyle=state.palette.handle;context.lineCap='butt';context.lineJoin='miter';context.stroke();
}
for(let i=0;i<4;i++){const [x,y]=points[i],rad=5/s;context.beginPath();context.arc(x,y,rad,0,2*Math.PI);context.fillStyle='#fff';context.strokeStyle=state.hover?.kind==='roi-corner'&&state.hover.index===i?'#111b42':state.palette.handle;context.lineWidth=3/s;context.stroke();context.fill();}context.restore();}}
/**
 * Composite source pixels and visible annotation layers into a canvas context.
 *
 * @description Shared by preview and image exports; respects drawing order and crop window and excludes editor-only adornments from export.
 * @param {CanvasRenderingContext2D} context - Rendering canvas 2D context.
 * @param {Object} windowRect - Visible source-pixel viewport.
 * @param {Object} opts - Renderer options controlling preview and export.
 *
 * <br><b>Composition pipeline:</b>
 * Save the target canvas transform, translate and scale by the source-image window, draw the exact decoded source image, then draw the visible numbered/arrow layers back-to-front. ROI and transient selection are included only where opts permit. Restore the canvas transform.
 */
function render(context,windowRect,opts={}){const scale=opts.scale??1;context.save();context.transform(scale,0,0,scale,-windowRect.x*scale,-windowRect.y*scale);context.clearRect(windowRect.x,windowRect.y,windowRect.w,windowRect.h);context.drawImage(state.img,0,0);for(const layer of [...state.front].reverse()){if(!state.visible[layer])continue;for(const item of state.items[layer]){if(layer==='numbering')circleDraw(context,item);else arrowDraw(context,item);}}if(!opts.crop)roiDraw(context,validRoi(),!!opts.preview,false);if(opts.preview)selectionDraw(context);context.restore();}
/**
 * Redraw the interactive editor preview from the current state.
 *
 * @description Clears and renders canvas content, then draws transient selection feedback separately.
 */
function paint(){if(!state.loaded)return;render(ctx,state.window,{scale:canvas.width/state.window.w,preview:true,crop:state.view==='crop'});updateFilename();}
/**
 * ==========================================================================
 * 05. Pointer hit testing, gestures and selection
 * ==========================================================================
 */
/**
 * Check whether a numeric value lies between two endpoints.
 *
 * @description Accepts endpoints in either order to support drag direction changes.
 * @param {number} x - Horizontal coordinate or number.
 * @param {Object} a - Stored arrow annotation.
 * @param {Object} b - Input used by between.
 * @returns {boolean} Whether the requested condition is valid.
 */
function between(x,a,b){return x>=a&&x<=b;}
/**
 * Report whether the loaded image can currently accept pointer edits.
 *
 * @description Editing is blocked when the active layer is hidden or ROI is displayed in crop-only mode.
 * @returns {boolean} Whether the requested condition is valid.
 */
function isEditing(){return state.loaded&&state.visible[state.active]}
/**
 * Hit-test numbered annotations in intrinsic image coordinates.
 *
 * @description Returns the nearest eligible circle under the pointer, or no selection.
 * @param {Object} p - Point, project manifest or numeric value as specified by the function.
 * @returns {number} Computed numeric value in image coordinate space.
 */
function circleHit(p){const arr=state.items.numbering;for(let i=arr.length-1;i>=0;i--)if(Math.hypot(p.x-arr[i].x,p.y-arr[i].y)<=arr[i].radius)return i;return -1;}
/**
 * Transform a point into the arrow's rotated local coordinate system.
 *
 * @description Used by arrow-body and corner hit testing without altering the stored arrow angle.
 * @param {Object} a - Stored arrow annotation.
 * @param {Object} p - Point, project manifest or numeric value as specified by the function.
 * @returns {Object} Result of the operation.
 */
function arrowLocal(a,p){let dx=p.x-a.x,dy=p.y-a.y,co=Math.cos(a.angle),si=Math.sin(a.angle);return {x:dx*co+dy*si,y:-dx*si+dy*co};}
/**
 * Hit-test arrow handles and bodies for selection and rotation.
 *
 * @description Prioritizes corner handles then the arrow body, respecting the current image scale.
 * @param {Object} p - Point, project manifest or numeric value as specified by the function.
 * @returns {Object|null} Result of the operation.
 */
function arrowHit(p){const arr=state.items.arrows,slop=8/state.scale;const selected=state.selection.arrows;if(selected>=0&&arr[selected]){const a=arr[selected],local=arrowLocal(a,p),corners=[[-a.w/2,-a.h/2],[a.w/2,-a.h/2],[a.w/2,a.h/2],[-a.w/2,a.h/2]];for(let j=0;j<4;j++){const [cx,cy]=corners[j];if(Math.abs(local.x-cx)<=5/state.scale&&Math.abs(local.y-cy)<=5/state.scale)return {kind:'corner',i:selected,index:j};}}for(let i=arr.length-1;i>=0;i--){const a=arr[i],local=arrowLocal(a,p),x=local.x,y=local.y;const qx=clamp(x,-a.w/2,a.w/2),qy=clamp(y,-a.h/2,a.h/2);if(Math.hypot(x-qx,y-qy)<=slop)return {kind:'body',i};}return null;}
/**
 * Identify ROI corner, edge or interior hit targets.
 *
 * @description The result drives resize cursors and the corresponding pointer gesture.
 * @param {Object} p - Point, project manifest or numeric value as specified by the function.
 * @returns {Object|null} Result of the operation.
 */
function roiHit(p){const r=validRoi();if(!r)return {kind:'new'};const s=9/state.scale,x0=r.x,y0=r.y,x1=x0+r.w,y1=y0+r.h;const corners=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];for(let i=0;i<4;i++)if(Math.hypot(p.x-corners[i][0],p.y-corners[i][1])<=s)return {kind:'roi-corner',index:i};if(between(p.y,y0-s,y1+s)){if(Math.abs(p.x-x0)<=s)return {kind:'roi-edge',index:3};if(Math.abs(p.x-x1)<=s)return {kind:'roi-edge',index:1};}if(between(p.x,x0-s,x1+s)){if(Math.abs(p.y-y0)<=s)return {kind:'roi-edge',index:0};if(Math.abs(p.y-y1)<=s)return {kind:'roi-edge',index:2};}if(between(p.x,x0,x1)&&between(p.y,y0,y1))return {kind:'roi-move'};return null;}
/**
 * Start an edit gesture or create a new annotation on pointer down.
 *
 * @description Captures a pre-edit history snapshot and pointer capture so drag operations become one undo step.
 * @param {PointerEvent} e - Pointer event on the editor canvas.
 *
 * <br><b>Gesture lifecycle:</b>
 * Resolve tool-specific hit targets. Either select an existing geometry or create a new numbered circle, arrow, or ROI start point. Capture pre-edit state and pointer ID before updating the preview.
 */
function beginPointer(e){if(e.button!==0||state.pointer||!isEditing())return;if(state.active==='roi'&&state.view==='crop')return;const id=state.active,p=pointerPos(e),before=capture(id);let kind='',index=-1,origin=null;if(id==='numbering'){index=circleHit(p);if(index>=0){state.selection.numbering=index;kind='move';origin=clone(state.items.numbering[index]);}else{kind='new';const c=state.settings.numbering,style=effectiveStyle(id);state.items.numbering.push({x:p.x,y:p.y,number:state.items.numbering.length+1,radius:c.radius/state.scale,strokeWidth:c.stroke/state.scale,style,fill:style===1?c.standardFill:c.invertedFill,stroke:style===1?c.standardStroke:c.invertedStroke});state.selection.numbering=state.items.numbering.length-1;}}else if(id==='arrows'){const hit=arrowHit(p);if(hit){index=hit.i;state.selection.arrows=index;kind=hit.kind;origin=clone(state.items.arrows[index]);}else{const a=state.settings.arrows,style=effectiveStyle(id);state.items.arrows.push({x:p.x,y:p.y,w:a.width/state.scale,h:a.height/state.scale,tail:a.tail,head:a.head,angle:0,style,fill:style===1?a.standardFill:a.invertedFill,stroke:style===1?a.standardStroke:a.invertedStroke});state.selection.arrows=state.items.arrows.length-1;kind='new';}}else{const hit=roiHit(p);if(!hit)return;kind=hit.kind;origin=clone(state.items.roi);if(kind==='new'){state.items.roi={x:p.x,y:p.y,w:0,h:0};}else if(kind==='roi-corner'||kind==='roi-edge')index=hit.index;}state.pointer={id:e.pointerId,layer:id,kind,index,before,start:p,origin};canvas.setPointerCapture(e.pointerId);paint();}
const ROTATE_CURSOR='url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2228%22%20height%3D%2228%22%20viewBox%3D%220%200%2028%2028%22%3E%3Cpath%20d%3D%22M21.5%2012.8A8.1%208.1%200%201%201%2019.3%208%22%20fill%3D%22none%22%20stroke%3D%22white%22%20stroke-width%3D%224.8%22%20stroke-linecap%3D%22round%22%2F%3E%3Cpath%20d%3D%22M21.5%2012.8A8.1%208.1%200%201%201%2019.3%208%22%20fill%3D%22none%22%20stroke%3D%22%23111B42%22%20stroke-width%3D%222.5%22%20stroke-linecap%3D%22round%22%2F%3E%3Cpath%20d%3D%22M18%202.6V9h6.4%22%20fill%3D%22none%22%20stroke%3D%22white%22%20stroke-width%3D%225%22%20stroke-linejoin%3D%22round%22%2F%3E%3Cpath%20d%3D%22M18%202.6V9h6.4%22%20fill%3D%22none%22%20stroke%3D%22%23111B42%22%20stroke-width%3D%222.6%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E") 14 14, crosshair';
/**
 * Update current drag gesture and interactive hit-state feedback.
 *
 * @description Handles movement, resizing and rotation in original-image coordinates while clamping relevant geometry.
 * @param {PointerEvent} e - Pointer event on the editor canvas.
 *
 * <br><b>Tool-specific geometry:</b>
 * Move numbered circles by delta; move arrow bodies or rotate by corner vector; move or resize ROI by its edges/corners. Create a new ROI by its min/max drag endpoints so negative drag directions also work.
 */
function movePointer(e){if(!state.loaded)return;const p=pointerPos(e),drag=state.pointer;if(drag&&drag.id===e.pointerId){const dx=p.x-drag.start.x,dy=p.y-drag.start.y,id=drag.layer;if(id==='numbering'&&drag.kind==='move'){let c=state.items.numbering[state.selection.numbering];c.x=drag.origin.x+dx;c.y=drag.origin.y+dy;}if(id==='arrows'){let a=state.items.arrows[state.selection.arrows];if(drag.kind==='body'){a.x=drag.origin.x+dx;a.y=drag.origin.y+dy;}else if(drag.kind==='corner'){a.angle=Math.atan2(p.y-a.y,p.x-a.x);}}if(id==='roi'){const r=drag.origin;if(drag.kind==='new'){state.items.roi={x:Math.min(drag.start.x,p.x),y:Math.min(drag.start.y,p.y),w:Math.abs(dx),h:Math.abs(dy)};}else if(drag.kind==='roi-move'){state.items.roi={...r,x:r.x+dx,y:r.y+dy};}else if(drag.kind==='roi-edge'||drag.kind==='roi-corner'){let x0=r.x,y0=r.y,x1=r.x+r.w,y1=r.y+r.h;const ix=drag.index;if(drag.kind==='roi-corner'){if(ix===0||ix===3)x0+=dx;else x1+=dx;if(ix===0||ix===1)y0+=dy;else y1+=dy;}else{if(ix===0)y0+=dy;if(ix===1)x1+=dx;if(ix===2)y1+=dy;if(ix===3)x0+=dx;}state.items.roi={x:Math.min(x0,x1),y:Math.min(y0,y1),w:Math.abs(x1-x0),h:Math.abs(y1-y0)};}}paint();return;}
const next=state.active==='arrows'?arrowHit(p):state.active==='numbering'?circleHit(p):roiHit(p);state.hover=next&&typeof next==='object'?next:null;if(!state.visible[state.active]){canvas.style.cursor='not-allowed';return;}if(state.active==='roi'&&state.view==='crop'){canvas.style.cursor='default';return;}const kind=next?.kind||next;canvas.style.cursor=(kind==='body'||kind==='roi-move'||typeof kind==='number')?'move':kind==='corner'?ROTATE_CURSOR:kind==='roi-corner'?((next.index===0||next.index===2)?'nwse-resize':'nesw-resize'):kind==='roi-edge'?(next.index%2===0?'ns-resize':'ew-resize'):'crosshair';if(state.active==='arrows'||state.active==='roi')paint();}
/**
 * Finalize or cancel a pointer gesture.
 *
 * @description Reverts cancelled gestures; otherwise records exactly one tool history entry and recalculates ROI options.
 * @param {PointerEvent} e - Pointer event on the editor canvas.
 *
 * <br><b>Commit boundary:</b>
 * Pointer cancellation restores the pre-drag snapshot. A normal pointer release validates ROI, pushes one history entry and synchronizes the UI. Mouse-move intermediate frames are not individual undo steps.
 */
function endPointer(e){const d=state.pointer;if(!d||e.pointerId!==d.id)return;state.pointer=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(e.type==='pointercancel'){restore(d.layer,d.before);}else{if(d.layer==='roi'){if(!validRoi())state.items.roi=null;updateROIOptions();}record(d.layer,d.before);}resizePreview();refreshToolbar();}
/**
 * Discard an in-progress edit and restore its pre-drag state.
 *
 * @description Also releases pointer capture to avoid stranded drag states when resetting or switching files.
 */
function cancelPointer(){const d=state.pointer;if(!d)return;state.pointer=null;restore(d.layer,d.before);if(canvas.hasPointerCapture(d.id))canvas.releasePointerCapture(d.id);paint();}
canvas.addEventListener('pointerdown',beginPointer);canvas.addEventListener('pointermove',movePointer);canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);canvas.addEventListener('pointerleave',()=>{if(!state.pointer){state.hover=null;paint();}});canvas.addEventListener('contextmenu',e=>e.preventDefault());
// Settings belong to each module; changing them is a single entry in that module's history.
// One global palette for all tools, independent numeric settings in module tabs.
/**
 * Per-panel settings schema used by both input generation and ZIP validation.
 * Entry layout: [field key, display label, input type, minimum, maximum, step].
 * The global palette uses color-only entries; per-tool numeric bounds are applied
 * before they can affect drawing geometry or be restored from saved projects.
 */
const fieldDefs={
 global:[['standardStroke','Standard · outline','color'],['standardFill','Standard · fill','color'],['standardText','Standard · number color','color'],['invertedStroke','Inverted · outline','color'],['invertedFill','Inverted · fill','color'],['invertedText','Inverted · number color','color'],['handle','Handle color','color'],['roiOverlayColor','ROI overlay color','color']],
 numbering:[['radius','Circle radius / Kreisradius','number',1,999,1],['stroke','Stroke thickness / Strichstärke','number',0,100,1],['fontSize','Number size / Schriftgröße','number',1,200,1]],
 arrows:[['stroke','Arrow stroke / Strichstärke','number',0,80,1],['width','Arrow width / Breite','number',5,3000,1],['height','Arrow height / Höhe','number',5,3000,1],['tail','Tail fraction / Schaft','number',.05,.95,.01],['head','Head fraction / Spitze','number',.05,.95,.01]],
 roi:[['border','ROI border thickness / Rahmenstärke','number',0,100,1],['borderRadius','ROI corner radius / Eckenradius','number',0,500,1],['overlayAlpha','Overlay opacity / Deckkraft','number',0,1,.05]]
};
let settingDraft=null,settingTab='global';
/**
 * ==========================================================================
 * 06. Settings schema, validation and dialog lifecycle
 * ==========================================================================
 */
/**
 * Build the accessible global and tool-specific settings tabs.
 *
 * @description Validates the current draft before switching tabs so changes are not lost.
 */
function renderSettingsTabs(){const tabs=$('settingsTabs');tabs.replaceChildren();for(const id of ['global','arrows','numbering','roi']){const b=document.createElement('button');b.type='button';b.textContent=id==='global'?t('globalTab'):t(id);b.classList.toggle('selected',id===settingTab);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(id===settingTab));b.onclick=()=>{if(!collectSettingsDraft())return;settingTab=id;renderSettingsTabs();renderSettingsFields();};tabs.append(b);}}
/**
 * Create editable settings inputs for the active settings category.
 *
 * @description Field definitions control type, bounds and step; the global tab also includes JPEG compression choices.
 */
function renderSettingsFields(){const fields=$('settingsFields');fields.replaceChildren();const draft=settingTab==='global'?settingDraft.palette:settingDraft.settings[settingTab];for(const [key,label,type,min,max,step] of fieldDefs[settingTab]){const lab=document.createElement('label');lab.setAttribute('for','cfg_'+key);lab.textContent=label;const inp=document.createElement('input');inp.id='cfg_'+key;inp.dataset.key=key;inp.type=type;inp.value=draft[key];if(type==='number'){inp.min=String(min);inp.max=String(max);inp.step=String(step);}fields.append(lab,inp);}
 if(settingTab==='global'){
  const lab=document.createElement('label');lab.setAttribute('for','cfg_jpegCompression');lab.textContent=t('jpegCompression');
  const select=document.createElement('select');select.id='cfg_jpegCompression';select.dataset.key='jpegCompression';
  for(const level of ['low','medium','high']){const option=document.createElement('option');option.value=level;option.textContent=t('jpeg'+level[0].toUpperCase()+level.slice(1));select.append(option);}
  select.value=settingDraft.jpegCompression;
  fields.append(lab,select);
 }
}
/**
 * Validate the visible settings inputs and update the temporary draft.
 *
 * @description Rejects invalid numeric ranges, hex colors or JPEG levels; no live editor state changes until Save.
 * @returns {boolean} Whether the requested condition is valid.
 *
 * <br><b>Apply-on-save behavior:</b>
 * Read only the controls for the currently selected settings tab. Reject a field and focus it on invalid input; the active project is modified only by the Save handler after all draft values pass.
 */
function collectSettingsDraft(){if(!settingDraft)return false;const target=settingTab==='global'?settingDraft.palette:settingDraft.settings[settingTab];for(const [key,,type,min,max] of fieldDefs[settingTab]){const el=$('cfg_'+key),value=el.value;if(type==='number'){const n=Number(value);if(!value.trim()||!Number.isFinite(n)||n<min||n>max){toast(t('badSettings'));el.focus();return false;}target[key]=n;}else{if(!/^#[a-fA-F0-9]{6}$/.test(value)){toast(t('badSettings'));el.focus();return false;}target[key]=value;}}if(settingTab==='global'){
  const level=$('cfg_jpegCompression').value;
  if(!Object.hasOwn(JPEG_QUALITY,level)){toast(t('badSettings'));$('cfg_jpegCompression').focus();return false;}
  settingDraft.jpegCompression=level;
 }
 return true;}
/**
 * Open the settings dialog using a deep-cloned draft.
 *
 * @description Cannot open before an image is loaded; focuses Save for keyboard access.
 */
function openSettings(){if(!state.loaded){toast(t('noImage'));return;}settingDraft={palette:clone(state.palette),settings:clone(state.settings),jpegCompression:state.jpegCompression};settingTab='global';$('settingsTitle').textContent=t('settingsTitle');renderSettingsTabs();renderSettingsFields();$('overlay').style.display='block';$('settingsPopup').style.display='block';$('settingsSaveButton').focus();}
/**
 * Dismiss the settings dialog without applying pending draft edits.
 *
 * @description Clears the draft and restores focus to the toolbar Settings button.
 */
function closeSettings(){settingDraft=null;$('overlay').style.display='none';$('settingsPopup').style.display='none';$('settingsButton').focus();}
$('settingsButton').onclick=openSettings;$('settingsCancelButton').onclick=closeSettings;
$('settingsResetButton').onclick=()=>{if(!settingDraft)return;if(settingTab==='global'){settingDraft.palette=clone(defaultPalette);settingDraft.jpegCompression=DEFAULT_JPEG_COMPRESSION;}else settingDraft.settings[settingTab]=clone(defaults[settingTab]);renderSettingsFields();};
$('settingsSaveButton').onclick=()=>{if(!collectSettingsDraft())return;const before={arrows:capture('arrows'),numbering:capture('numbering'),roi:capture('roi')};if(JSON.stringify(state.palette)!==JSON.stringify(settingDraft.palette)||JSON.stringify(state.settings)!==JSON.stringify(settingDraft.settings)||state.jpegCompression!==settingDraft.jpegCompression)markDirty();state.palette=clone(settingDraft.palette);state.settings=clone(settingDraft.settings);state.jpegCompression=settingDraft.jpegCompression;for(const id of ['arrows','numbering','roi'])record(id,before[id]);closeSettings();refreshToolbar();paint();};
$('overlay').onclick=closeSettings;
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('settingsPopup').style.display==='block'){e.preventDefault();closeSettings();}});
// Images and project ZIPs can be dropped or selected. No network access is required.
/**
 * ==========================================================================
 * 07. Image loading, reset and file selection
 * ==========================================================================
 */
/**
 * Allocate independent empty undo/redo stacks for the three tools.
 *
 * @description Used when starting a new project or preparing a newly loaded image.
 * @returns {Histories} Result of the operation.
 */
function defaultHistory(){return {arrows:{undo:[],redo:[]},numbering:{undo:[],redo:[]},roi:{undo:[],redo:[]}};}
/**
 * Return the editor to the no-image state without reloading the page.
 *
 * @description Clears all annotations, history, files and export UI; keeps the user's currently selected interface language.
 */
function resetToInitial(){cancelPointer();state.loaded=false;state.img=null;state.sourceFile=null;state.name='';state.palette=clone(defaultPalette);state.settings=clone(defaults);state.jpegCompression=DEFAULT_JPEG_COMPRESSION;state.front=['arrows','numbering'];state.active='arrows';state.visible={arrows:true,numbering:true,roi:true};state.items={arrows:[],numbering:[],roi:null};state.hist=defaultHistory();state.dirty=false;state.selection={arrows:-1,numbering:-1};state.preferred={arrows:1,numbering:1};state.ctrl=false;state.hover=null;state.pointer=null;state.view='full';state.baseScale=1;$('fileInput').value='';$('cont_drop_zone').style.display='block';$('layerContainer').style.display='none';$('image').style.display='none';$('download').style.display='none';document.querySelector('input[name=view][value=full]').checked=true;document.querySelector('input[name=exportScope][value=full]').checked=true;$('borderCheckboxROI').checked=false;$('timestampCheckbox').checked=true;refreshLanguage();updateROIOptions();}
$('newProjectButton').onclick=()=>{if(state.loaded&&!window.confirm(t('confirmNew')))return;resetToInitial();};
/**
 * Trigger the hidden file chooser from the accessible UI button.
 *
 * @description The chooser accepts images and Image Studio project ZIP archives.
 */
function openFilePicker(){$('fileInput').click();}
$('selectFileButton').onclick=e=>{e.stopPropagation();openFilePicker();};
$('drop_zone').addEventListener('click',e=>{if(e.target.id!=='selectFileButton')openFilePicker();});
$('drop_zone').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target===$('drop_zone')){e.preventDefault();openFilePicker();}});
for(const name of ['dragenter','dragover'])$('drop_zone').addEventListener(name,e=>{e.preventDefault();$('drop_zone').classList.add('dragover');});
$('drop_zone').addEventListener('dragleave',e=>{e.preventDefault();$('drop_zone').classList.remove('dragover');});
$('drop_zone').addEventListener('drop',async e=>{e.preventDefault();$('drop_zone').classList.remove('dragover');if(e.dataTransfer.files.length)await acceptFile(e.dataTransfer.files[0]);});
document.addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files'))e.preventDefault();});
document.addEventListener('drop',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files'))e.preventDefault();});
$('fileInput').addEventListener('change',async e=>{if(e.target.files.length)await acceptFile(e.target.files[0]);e.target.value='';});
/**
 * Route a selected or dropped file to image or project import.
 *
 * @description ZIP suffix/MIME dispatches to project import; other files are checked by the image pipeline.
 * @param {File} file - User-selected image or project file.
 * @returns {Promise<boolean>} Whether image/project loading completed successfully.
 */
async function acceptFile(file){if(!file)return false;if(/\.zip$/i.test(file.name)||/^(application\/zip|application\/x-zip-compressed)$/.test(file.type))return importProject(file);return loadFile(file);}
let latestLoadRequest=0;
/**
 * Decode and validate a candidate image without mutating live editor state.
 *
 * @description Enforces file/dimension limits and browser canvas safety checks before committing the image.
 * @param {File} file - User-selected image or project file.
 * @returns {Promise<Object>} Result of the operation.
 * @throws {Error} When the candidate fails validation or exceeds supported limits.
 *
 * <br><b>Safety before state mutation:</b>
 * Validate MIME/file bytes and actual decoded image dimensions. Check that browser canvas capacities allow use of the image; return a prepared payload rather than replacing the user's active image prematurely.
 */
async function prepareImage(file){
 if(!file||!/^image\//.test(file.type)||file.type==='image/svg+xml')throw new Error('Unsupported image');
 if(file.size>MAX_IMAGE_BYTES)throw new Error('Image file exceeds 65 MB limit');
 const url=URL.createObjectURL(file),img=new Image();
 try{
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Image decoder rejected file'));img.src=url;});
  checkImageSize(img.naturalWidth,img.naturalHeight,file.size);
  // Prove a canvas can allocate and draw this image before touching the open project.
  const factor=Math.min(1,1200/img.naturalWidth,900/img.naturalHeight);
  const proof=document.createElement('canvas');
  proof.width=Math.max(1,Math.round(img.naturalWidth*factor));
  proof.height=Math.max(1,Math.round(img.naturalHeight*factor));
  const proofCtx=proof.getContext('2d');
  if(!proofCtx)throw new Error('Canvas unavailable');
  proofCtx.drawImage(img,0,0,proof.width,proof.height);
  return {img,file};
 }finally{URL.revokeObjectURL(url);}
}
/**
 * Install a successfully prepared image as the current source.
 *
 * @description Resets annotations and histories, updates metadata, activates editor panels and rerenders controls.
 * @param {Object} prepared - Successfully decoded and validated image payload.
 *
 * <br><b>State reset:</b>
 * Install the decoded image and source File, discard previous annotations/history/selection, show the editor, set the base scale and refresh preview, layer and export controls.
 */
function commitImage(prepared){
 const {img,file}=prepared;
 state.img=img;state.sourceFile=file;state.name=file.name;state.loaded=true;
 state.items={arrows:[],numbering:[],roi:null};state.hist=defaultHistory();
 state.selection={arrows:-1,numbering:-1};state.pointer=null;state.hover=null;state.view='full';
 $('cont_drop_zone').style.display='none';$('layerContainer').style.display='block';
 $('image').style.display='block';$('download').style.display='block';
 $('imageNameDisplay').textContent=state.name;
 $('imageDimensions').textContent=`${img.naturalWidth} × ${img.naturalHeight} px`;
 resizePreview();state.baseScale=state.scale;updateROIOptions();drawCards();refreshToolbar();
 resizePreview();
}
/**
 * Open a new image while protecting existing unsaved work.
 *
 * @description Performs asynchronous preparation first, honors latest-request sequencing and reports localized failures.
 * @param {File} file - User-selected image or project file.
 * @returns {Promise<boolean>} Whether image/project loading completed successfully.
 *
 * <br><b>Asynchronous race control:</b>
 * Each file request gets an incrementing request identifier. Late completions from earlier requests cannot replace a newer image selection. Errors are localized and leave the current project available.
 */
async function loadFile(file){
 const request=++latestLoadRequest;
 try{
  const prepared=await prepareImage(file);
  if(request!==latestLoadRequest)return false;
  commitImage(prepared);
  markDirty(); // An image alone has not yet been saved as a Studio project.
  toast(t('imageReplaced'));
  return true;
 }catch(err){console.error('Image load failed:',err);if(request===latestLoadRequest)toast(imageFailureMessage(err));return false;}
}
// Global export: render once at original pixels, optionally crop; no editor handles,
// CSS shadows, view-only selection, or UI elements enter the exported bitmap.
/**
 * ==========================================================================
 * 08. Full-resolution PNG and JPEG export
 * ==========================================================================
 */
/**
 * Stroke a rounded border into the provided export canvas.
 *
 * @description Uses the same rounded rectangle helper and supplied width/color for ROI border export.
 * @param {CanvasRenderingContext2D} context - Rendering canvas 2D context.
 * @param {number} x - Horizontal coordinate or number.
 * @param {number} y - Vertical coordinate or number.
 * @param {number} w - Width in pixels.
 * @param {number} h - Height in pixels.
 * @param {number} r - Corner radius in pixels.
 * @param {number} lineWidth - Stroke width in source-image pixels.
 * @param {string} color - CSS-compatible stroke color.
 */
function roundedBorder(context,x,y,w,h,r,lineWidth,color){context.save();roundedPath(context,x,y,w,h,r);context.lineWidth=lineWidth;context.strokeStyle=color;context.stroke();context.restore();}
/**
 * Download a generated Blob through a temporary object URL.
 *
 * @description Removes the temporary anchor and schedules URL revocation to avoid leaking browser resources.
 * @param {Blob} blob - Binary output to download.
 * @param {string} name - Suggested download filename.
 */
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
/**
 * Export visible layers as a full-resolution PNG or JPEG.
 *
 * @description The requested scope may be full image or ROI crop. JPEG uses white background and user-selected quality; oversized exports are rejected.
 * @param {string} format - Output format (png or jpg).
 * @returns {Promise<void>} Resolves after export encoding and download initiation.
 *
 * <br><b>Export algorithm:</b>
 * Select full image or validated ROI and compute original-pixel canvas dimensions, optionally adding border thickness. Draw visible annotations through render; apply ROI clipping/rounding; composite white behind pixels for JPEG; then call canvas.toBlob with MIME and quality. Release the disabled button in finally.
 */
async function exportImage(format){
 if(!state.loaded)return;
 const jpeg=format==='jpg';
 const button=$(jpeg?'downloadJpgBtn':'downloadFlattenedImageBtn');
 button.disabled=true;
 try{
  const roi=state.visible.roi?validRoi():null,crop=$('exportCrop').checked&&!!roi;
  const win=crop?roi:{x:0,y:0,...imageDims()};
  const border=crop&&$('borderCheckboxROI').checked?state.settings.roi.border/state.baseScale:0;
  const width=Math.max(1,Math.round(win.w+border)),height=Math.max(1,Math.round(win.h+border));
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width>MAX_IMAGE_SIDE||height>MAX_IMAGE_SIDE||width*height>MAX_EXPORT_PIXELS)throw new Error('Image export size limit');
  const exportCanvas=document.createElement('canvas');exportCanvas.width=width;exportCanvas.height=height;
  if(exportCanvas.width!==width||exportCanvas.height!==height)throw new Error('Canvas allocation failed');
  const out=exportCanvas.getContext('2d');if(!out)throw new Error('Canvas context unavailable');
  if(border){
   out.save();out.translate(border/2,border/2);roundedPath(out,0,0,win.w,win.h,state.settings.roi.borderRadius/state.baseScale);out.clip();render(out,win,{scale:1,crop:true});out.restore();
   roundedBorder(out,border/2,border/2,win.w,win.h,state.settings.roi.borderRadius/state.baseScale,border,state.palette.standardStroke);
  }else{
   out.save();if(crop&&state.settings.roi.borderRadius){roundedPath(out,0,0,win.w,win.h,state.settings.roi.borderRadius/state.baseScale);out.clip();}
   render(out,win,{scale:1,crop});out.restore();
  }
  if(jpeg){
   // JPEG does not support transparency. Put white *behind* image pixels;
   // no second full-resolution canvas is needed.
   out.save();out.globalCompositeOperation='destination-over';out.fillStyle='#ffffff';out.fillRect(0,0,width,height);out.restore();
  }
  const mime=jpeg?'image/jpeg':'image/png';
  const quality=jpeg?JPEG_QUALITY[state.jpegCompression]:undefined;
  const blob=await new Promise((resolve,reject)=>exportCanvas.toBlob(b=>b?resolve(b):reject(new Error('Image encoder returned empty data')),mime,quality));
  if(!blob.size||blob.type!==mime)throw new Error('Unsupported or empty image output');
  downloadBlob(blob,filename(jpeg?'jpg':'png'));
 }catch(err){console.error((jpeg?'JPEG':'PNG')+' export failed:',err);toast(t(jpeg?'jpegExportError':'exportTooLarge'));}
 finally{button.disabled=false;}
}
$('downloadFlattenedImageBtn').onclick=()=>exportImage('png');
$('downloadJpgBtn').onclick=()=>exportImage('jpg');
// Image Studio Project ZIP v1. Pure JS ZIP/STORE, with CRC-32 and no external libraries.
// The ZIP contains project.json plus the original image's exact original bytes.
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const zipTable=(()=>{const arr=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;arr[n]=c>>>0;}return arr;})();
/**
 * ==========================================================================
 * 09. ZIP archive writing, reading and integrity checks
 * ==========================================================================
 */
/**
 * Calculate an unsigned CRC-32 checksum for ZIP entry bytes.
 *
 * @description Used both when generating project archives and validating imports before restoring any live state.
 * @param {Uint8Array} bytes - Byte sequence to checksum.
 * @returns {number} Unsigned CRC-32 of the provided bytes.
 */
function crc32(bytes){let c=0xffffffff;for(let i=0;i<bytes.length;i++)c=zipTable[(c^bytes[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;}
/**
 * Write a little-endian 16-bit field into a ZIP DataView.
 *
 * @description Used for ZIP headers and directory sizes.
 * @param {DataView} view - Writable ZIP header view.
 * @param {number} at - Byte offset into the DataView.
 * @param {number} x - Horizontal coordinate or number.
 */
function u16(view,at,x){view.setUint16(at,x,true);}
/**
 * Write a little-endian 32-bit field into a ZIP DataView.
 *
 * @description Used for ZIP signatures, checksums, offsets and sizes.
 * @param {DataView} view - Writable ZIP header view.
 * @param {number} at - Byte offset into the DataView.
 * @param {number} x - Horizontal coordinate or number.
 */
function u32(view,at,x){view.setUint32(at,x>>>0,true);}
/**
 * Assemble the uncompressed, dependency-free ZIP project container.
 *
 * @description Writes local headers, payloads, central directory and end record; rejects oversized entries.
 * @param {Array<Object>} entries - Named byte arrays to store in the ZIP.
 * @returns {Uint8Array} Result of the operation.
 * @throws {Error} When the candidate fails validation or exceeds supported limits.
 *
 * <br><b>ZIP/STORE layout:</b>
 * For each entry, calculate CRC-32, write a local header, store uncompressed bytes, then record its central-directory entry. Append the end-of-central-directory record and emit a Blob; no compression library is needed.
 */
function createZip(entries){const blocks=[],central=[];let offset=0;for(const {name,data} of entries){const n=enc.encode(name),crc=crc32(data),size=data.length;if(n.length>65535||size>=0xffffffff)throw new Error('ZIP entry too large');const local=new Uint8Array(30+n.length),v=new DataView(local.buffer);u32(v,0,0x04034b50);u16(v,4,20);u16(v,6,0x0800);u16(v,8,0);u32(v,14,crc);u32(v,18,size);u32(v,22,size);u16(v,26,n.length);local.set(n,30);blocks.push(local,data);const cent=new Uint8Array(46+n.length),cv=new DataView(cent.buffer);u32(cv,0,0x02014b50);u16(cv,4,20);u16(cv,6,20);u16(cv,8,0x0800);u16(cv,10,0);u32(cv,16,crc);u32(cv,20,size);u32(cv,24,size);u16(cv,28,n.length);u32(cv,42,offset);cent.set(n,46);central.push(cent);offset+=local.length+size;}
const cdSize=central.reduce((sum,b)=>sum+b.length,0),ending=new Uint8Array(22),ev=new DataView(ending.buffer);u32(ev,0,0x06054b50);u16(ev,8,entries.length);u16(ev,10,entries.length);u32(ev,12,cdSize);u32(ev,16,offset);return new Blob([...blocks,...central,ending],{type:'application/zip'});}
/**
 * Parse and verify a narrowly supported project ZIP archive.
 *
 * @description Requires two stored entries, valid central-directory metadata, safe names and matching CRC values; rejects encryption and compression.
 * @param {Uint8Array} data - ZIP data or checksummed bytes.
 * @returns {Map<string, Uint8Array>} Validated named ZIP entry data.
 * @throws {Error} When the candidate fails validation or exceeds supported limits.
 *
 * <br><b>Parser restrictions:</b>
 * Find EOCD within the ZIP comment search range and require exactly the expected entries. For every stored entry verify signatures, bounds, duplicate-free safe names, unencrypted STORE method, byte lengths and checksum before accepting its bytes.
 */
function readZip(data){if(data.length>90*1024*1024)throw new Error('ZIP too large');const v=new DataView(data.buffer,data.byteOffset,data.byteLength);let eocd=-1;for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--){if(v.getUint32(i,true)===0x06054b50){eocd=i;break;}}if(eocd<0)throw new Error('Missing ZIP directory');const cnt=v.getUint16(eocd+10,true),sz=v.getUint32(eocd+12,true),base=v.getUint32(eocd+16,true);if(cnt!==2||base+sz>eocd)throw new Error('Unexpected ZIP archive');const files=new Map();let pos=base;for(let j=0;j<cnt;j++){if(pos+46>data.length||v.getUint32(pos,true)!==0x02014b50)throw new Error('Bad central directory');const flag=v.getUint16(pos+8,true),method=v.getUint16(pos+10,true),crc=v.getUint32(pos+16,true),packed=v.getUint32(pos+20,true),size=v.getUint32(pos+24,true),nameSize=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true),loc=v.getUint32(pos+42,true);if(flag&1||method!==0||size!==packed||size>65*1024*1024)throw new Error('Unsupported ZIP encoding');if(pos+46+nameSize+extra+comment>data.length)throw new Error('Corrupt directory');const name=dec.decode(data.subarray(pos+46,pos+46+nameSize));if(!/^[a-zA-Z0-9_.-]+$/.test(name)||files.has(name))throw new Error('Invalid ZIP filename');if(loc+30>data.length||v.getUint32(loc,true)!==0x04034b50)throw new Error('Missing ZIP file');const start=loc+30+v.getUint16(loc+26,true)+v.getUint16(loc+28,true);if(start+size>data.length)throw new Error('Truncated ZIP file');const bytes=data.subarray(start,start+size);if(crc32(bytes)!==crc)throw new Error('ZIP checksum mismatch');files.set(name,bytes);pos+=46+nameSize+extra+comment;}if(pos!==base+sz)throw new Error('Invalid ZIP directory size');return files;}
/**
 * ==========================================================================
 * 10. Project manifest validation and persistence
 * ==========================================================================
 */
/**
 * Validate a bounded finite numeric value from imported project data.
 *
 * @description Rejects non-numbers, infinity, NaN and absolute values beyond 1e8.
 * @param {number} n - Finite numeric candidate or ZIP integer.
 * @returns {boolean} Whether the requested condition is valid.
 */
function validFinite(n){return typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e8;}
/**
 * Validate tool-specific saved settings using field definitions.
 *
 * @description Checks numeric ranges for arrows, numbering and ROI to avoid corrupt geometry or canvas operations.
 * @param {Object} settings - Saved per-tool settings object.
 * @returns {boolean} Whether the requested condition is valid.
 */
function validSettings(settings){return settings&&['arrows','numbering','roi'].every(id=>settings[id]&&fieldDefs[id].every(([key,,type,min,max])=>type==='number'?validFinite(settings[id][key])&&settings[id][key]>=min&&settings[id][key]<=max:true));}
/**
 * Validate saved annotation shapes by tool and constrain list sizes.
 *
 * @description Checks required numeric fields and limits collections to 10,000 entries; ROI accepts null.
 * @param {string} id - Tool identifier: arrows, numbering or roi.
 * @param {Object} items - Saved annotations for the given tool.
 * @returns {boolean} Whether the requested condition is valid.
 */
function validItems(id,items){if(id==='roi')return items===null||(items&&['x','y','w','h'].every(k=>validFinite(items[k])));if(!Array.isArray(items)||items.length>10000)return false;const keys=id==='arrows'?['x','y','w','h','angle','tail','head','style']:['x','y','radius','number','strokeWidth','style'];return items.every(item=>item&&keys.every(k=>validFinite(item[k])));}
/**
 * Validate a saved undo/redo snapshot for one tool.
 *
 * @description Applies the same shape and settings checks used for active project state.
 * @param {string} id - Tool identifier: arrows, numbering or roi.
 * @param {Object} snap - Validated tool snapshot to restore.
 * @returns {boolean} Whether the requested condition is valid.
 */
function validSnap(id,snap){return snap&&validItems(id,snap.items)&&snap.settings&&fieldDefs[id].every(([k,,type,min,max])=>type==='number'?validFinite(snap.settings[k])&&snap.settings[k]>=min&&snap.settings[k]<=max:true);}
/**
 * Validate the complete project manifest against decoded ZIP files.
 *
 * @description Checks format/version, image metadata, layers, settings, histories, selection, export flags and language before state mutation.
 * @param {Object} p - Point, project manifest or numeric value as specified by the function.
 * @param {Map<string, Uint8Array>} files - Verified archive entry bytes keyed by safe filename.
 * @throws {Error} When the candidate fails validation or exceeds supported limits.
 *
 * <br><b>Pre-commit trust boundary:</b>
 * Reject a wrong format/version, missing source image, unsafe layer ordering, invalid numeric annotations, oversized histories, malformed colors, invalid view settings, or unsupported language. Only a validated manifest may enter commitImage.
 */
function validateProject(p,files){if(!p||p.format!=='ImageAnnotationStudio'||p.version!==1||!p.image||!p.state)throw new Error('Unknown project format');const im=p.image,x=p.state;if(typeof im.entry!=='string'||!/^original\.[a-zA-Z0-9]+$/.test(im.entry)||!files.has(im.entry)||typeof im.filename!=='string'||im.filename.length>255||!/^image\//.test(im.mime)||!validFinite(im.width)||!validFinite(im.height)||im.width<1||im.height<1)throw new Error('Invalid image metadata');checkImageSize(im.width,im.height,files.get(im.entry).length);if(!Array.isArray(x.front)||x.front.length!==2||x.front[0]===x.front[1]||!x.front.includes('arrows')||!x.front.includes('numbering'))throw new Error('Bad layer order');if(!names[x.active]||!x.visible||!['arrows','numbering','roi'].every(k=>typeof x.visible[k]==='boolean'))throw new Error('Bad layers');if(!x.items||!['arrows','numbering','roi'].every(k=>validItems(k,x.items[k])))throw new Error('Bad annotations');if(!validSettings(x.settings))throw new Error('Bad settings');if(!x.palette||!fieldDefs.global.every(([key])=>typeof x.palette[key]==='string'&&/^#[a-fA-F0-9]{6}$/.test(x.palette[key])))throw new Error('Bad palette');if(!x.preferred||!['arrows','numbering'].every(k=>x.preferred[k]===1||x.preferred[k]===2))throw new Error('Bad style');if(!x.hist||!['arrows','numbering','roi'].every(k=>x.hist[k]&&['undo','redo'].every(dir=>Array.isArray(x.hist[k][dir])&&x.hist[k][dir].length<=100&&x.hist[k][dir].every(s=>validSnap(k,s)))))throw new Error('Bad history');if(!x.selection||!['arrows','numbering'].every(k=>Number.isInteger(x.selection[k])&&x.selection[k]>=-1&&x.selection[k]<x.items[k].length))throw new Error('Bad selection');if(!validFinite(x.baseScale)||x.baseScale<=0||x.baseScale>10)throw new Error('Bad scale');if(!['full','crop'].includes(x.view)||!x.export||!['full','crop'].includes(x.export.scope)||typeof x.export.border!=='boolean'||typeof x.export.timestamp!=='boolean'||(x.export.jpegCompression!==undefined&&!Object.hasOwn(JPEG_QUALITY,x.export.jpegCompression)))throw new Error('Bad viewport');if(!['de','en','hu'].includes(x.lang))throw new Error('Bad locale');}
/**
 * Create a sortable, locally timestamped filename for the editable project ZIP.
 *
 * @description Preserves the original image name so multiple source images remain distinguishable.
 * Unlike the optional timestamp on PNG/JPG exports, every project ZIP includes a timestamp.
 * Sanitizes Windows-reserved filename characters; the project archive entries and ZIP format do not change.
 *
 * @param {string} sourceName - Original image filename, including its extension.
 * @param {Date} at - Local download date/time, injectable for deterministic tests.
 * @returns {string} Filename, e.g. 2026-10-11 (Time 11-23-22) _ 092_image-studio.zip.
 */
function projectFilename(sourceName=state.name,at=new Date()){
 const [date,time]=timestamp(at).split('_');
 const stem=(sourceName.replace(/\.[^.]*$/,'')||'image')
  .replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,160)||'image';
 return `${date} (Time ${time}) _ ${stem}_image-studio.zip`;
}
/**
 * Serialize the current editor state into a project manifest.
 *
 * @description Includes original-image metadata, visible layers, full per-tool histories, current language and JPEG compression selection.
 * @returns {Object} Result of the operation.
 *
 * <br><b>State included:</b>
 * Store original file identity and dimensions, layer ordering/visibility, active tool, annotation geometry, all tool histories, palette, UI language, crop-view state, optional border/timestamp and JPEG compression.
 */
function projectSnapshot(){return {format:'ImageAnnotationStudio',version:1,exportedAt:new Date().toISOString(),image:{entry:'',filename:state.name,mime:state.sourceFile.type,width:state.img.naturalWidth,height:state.img.naturalHeight},state:{front:clone(state.front),active:state.active,visible:clone(state.visible),items:clone(state.items),hist:clone(state.hist),selection:clone(state.selection),preferred:clone(state.preferred),settings:clone(state.settings),palette:clone(state.palette),baseScale:state.baseScale,view:state.view,lang:state.lang,export:{scope:document.querySelector('input[name=exportScope]:checked').value,border:$('borderCheckboxROI').checked,timestamp:$('timestampCheckbox').checked,jpegCompression:state.jpegCompression}}};}
$('downloadProjectBtn').onclick=async()=>{if(!state.loaded||!state.sourceFile)return;const button=$('downloadProjectBtn');button.disabled=true;try{const startedRevision=saveRevision;if(state.sourceFile.size>65*1024*1024)throw new Error('Image too large');const data=new Uint8Array(await state.sourceFile.arrayBuffer()),doc=projectSnapshot();const ext=/\.[a-zA-Z0-9]+$/.exec(state.name)?.[0]?.slice(1).toLowerCase()||'png';doc.image.entry='original.'+ext;const json=enc.encode(JSON.stringify(doc,null,2));if(json.length>12*1024*1024)throw new Error('Project history too large');const zip=createZip([{name:'project.json',data:json},{name:doc.image.entry,data}]);downloadBlob(zip,projectFilename());if(startedRevision===saveRevision)state.dirty=false;toast(t('projectSaved'));}catch(err){console.error('Project ZIP failed:',err);toast(t('projectTooLarge'));}finally{button.disabled=false;}};
/**
 * Restore an Image Studio ZIP after complete validation and image preparation.
 *
 * @description Decodes the archive, checks its original image, then commits all state atomically; older projects missing JPEG settings use Medium.
 * @param {File} file - User-selected image or project file.
 * @returns {Promise<boolean>} Whether image/project loading completed successfully.
 *
 * <br><b>Atomic import steps:</b>
 * Read ZIP -> parse project.json -> validate manifest -> decode original image -> verify intrinsic dimensions -> verify latest request -> commit and restore state. For older archives without JPEG setting use Medium. A failure leaves the previous project unchanged.
 */
async function importProject(file){
 const request=++latestLoadRequest;
 try{
  if(!file||file.size>90*1024*1024)throw new Error('Studio ZIP size limit');
  const raw=new Uint8Array(await file.arrayBuffer()),files=readZip(raw);
  if(!files.has('project.json')||files.get('project.json').length>12*1024*1024)throw new Error('Missing project JSON');
  const doc=JSON.parse(dec.decode(files.get('project.json')));
  validateProject(doc,files);
  const imageFile=new File([files.get(doc.image.entry)],doc.image.filename,{type:doc.image.mime});
  const prepared=await prepareImage(imageFile);
  if(prepared.img.naturalWidth!==doc.image.width||prepared.img.naturalHeight!==doc.image.height)throw new Error('Image dimensions mismatch');
  if(request!==latestLoadRequest)return false;
  // No live state is mutated before all archive, metadata, image and canvas checks pass.
  const x=doc.state;
  commitImage(prepared);
  state.front=clone(x.front);state.active=x.active;state.visible=clone(x.visible);
  state.items=clone(x.items);state.hist=clone(x.hist);state.selection=clone(x.selection);
  state.preferred=clone(x.preferred);state.settings=clone(x.settings);state.palette=clone(x.palette);state.jpegCompression=x.export.jpegCompression??DEFAULT_JPEG_COMPRESSION;
  state.baseScale=x.baseScale;state.lang=x.lang==='en'?'en':'de';$('languageSelect').value=state.lang;
  $('timestampCheckbox').checked=x.export.timestamp;updateROIOptions();
  state.view=x.view==='crop'&&state.visible.roi&&validRoi()?'crop':'full';
  document.querySelector(`input[name="view"][value="${state.view}"]`).checked=true;
  const scope=x.export.scope==='crop'&&state.visible.roi&&validRoi()?'crop':'full';
  document.querySelector(`input[name="exportScope"][value="${scope}"]`).checked=true;
  $('borderCheckboxROI').checked=x.export.border&&scope==='crop';
  updateExportBorder();refreshLanguage();resizePreview();drawCards();refreshToolbar();
  state.dirty=false;saveRevision++; // The imported file is the saved reference point.
  toast(t('projectLoaded'));return true;
 }catch(err){console.error('Import Studio Project failed:',err);if(request===latestLoadRequest)toast(t('importError'));return false;}
}
// Minimal inspection entry point for automated regression tests; not required by the UI.
window.__studioTest={state,loadFile,chooseLayer,undo,redo,deleteSelected,resizePreview,render,validRoi,resetToInitial,importProject,createZip,readZip,projectSnapshot,prepareImage,checkImageSize};
refreshLanguage();
