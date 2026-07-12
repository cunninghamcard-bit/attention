import { App } from "../app/App";
import { SettingTab } from "../app/SettingTab";
import { Component } from "../core/Component";
import { Events } from "../core/Events";
import { Editor } from "../editor/Editor";
import { editorEditorField, editorInfoField, editorLivePreviewField, editorViewField, livePreviewState } from "../editor/EditorStateField";
import { Keymap } from "../app/hotkeys/Keymap";
import { Scope } from "../app/hotkeys/Scope";
import { MarkdownRenderChild } from "../markdown/MarkdownRenderChild";
import { RenderContext } from "../markdown/RenderContext";
import { MarkdownPreviewRenderer } from "../markdown/MarkdownPreviewRenderer";
import { MarkdownPreviewSection } from "../markdown/MarkdownPreviewSection";
import { MarkdownPreviewView } from "../markdown/MarkdownPreviewView";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import { iterateCacheRefs, iterateRefs, MetadataCache } from "../metadata/MetadataCache";
import { Platform } from "../platform/Platform";
import { Plugin } from "../plugin/Plugin";
import { PluginSettingTab } from "../plugin/PluginSettingTab";
import { fuzzySearch, prepareFuzzySearch, prepareQuery, prepareSimpleSearch, renderMatches, renderResults, sortSearchResults } from "../search/SearchHelpers";
import { SecretStorage } from "../storage/SecretStorage";
import { AbstractInputSuggest, PopoverSuggest } from "../ui/suggest/AbstractInputSuggest";
import { EditorSuggest as EditorSuggestClass } from "../ui/suggest/EditorSuggest";
import { FuzzySuggestModal, SuggestModal } from "../ui/suggest/SuggestModal";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu";
import { addIcon, getIcon, getIconIds, removeIcon, setIcon as renderIcon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { Notice } from "../ui/Notice";
import { displayTooltip, HoverPopover, PopoverState, setTooltip } from "../ui/Popover";
import {
  AbstractTextComponent,
  BaseComponent,
  ButtonComponent,
  ColorComponent,
  DropdownComponent,
  ExtraButtonComponent,
  MomentFormatComponent,
  ProgressBarComponent,
  SearchComponent,
  SecretComponent,
  Setting,
  SettingGroup,
  SliderComponent,
  TextAreaComponent,
  TextComponent,
  ToggleComponent,
  ValueComponent
} from "../ui/Setting";
import { CapacitorAdapter } from "../vault/DataAdapter";
import { FileManager } from "../app/FileManager";
import { FileSystemAdapter } from "../vault/FileSystemAdapter";
import { TAbstractFile, TFile, TFolder } from "../vault/TAbstractFile";
import { Vault } from "../vault/Vault";
import { EditableFileView } from "../views/EditableFileView";
import { FileView } from "../views/FileView";
import { ItemView } from "../views/ItemView";
import { MarkdownView } from "../views/MarkdownView";
import { TextFileView } from "../views/TextFileView";
import { View } from "../views/View";
import { WorkspaceLeaf } from "../views/workspace/WorkspaceLeaf";
import { Workspace } from "../views/workspace/Workspace";
import { WorkspaceContainer } from "../views/workspace/WorkspaceContainer";
import { WorkspaceFloating } from "../views/workspace/WorkspaceFloating";
import { WorkspaceItem } from "../views/workspace/WorkspaceItem";
import { WorkspaceParent } from "../views/workspace/WorkspaceParent";
import { WorkspaceRibbon } from "../views/workspace/WorkspaceRibbon";
import { WorkspaceRoot } from "../views/workspace/WorkspaceRoot";
import { WorkspaceSidedock } from "../views/workspace/WorkspaceSidedock";
import { WorkspaceSplit } from "../views/workspace/WorkspaceSplit";
import { WorkspaceTabs } from "../views/workspace/WorkspaceTabs";
import { WorkspaceWindow } from "../views/workspace/WorkspaceWindow";
import { ViewRegistry } from "../views/workspace/ViewRegistry";
import {
  apiVersion,
  arrayBufferToBase64,
  arrayBufferToHex,
  base64ToArrayBuffer,
  debounce,
  finishRenderMath,
  getAllTags,
  getBlobArrayBuffer,
  getFrontMatterInfo,
  getLanguage,
  getLinkpath,
  hexToArrayBuffer,
  htmlToMarkdown,
  loadMathJax,
  loadMermaid,
  loadPdfJs,
  loadPrism,
  moment,
  normalizePath,
  parseFrontMatterAliases,
  parseFrontMatterEntry,
  parseFrontMatterStringArray,
  parseFrontMatterTags,
  parseLinktext,
  parseYaml,
  renderMath,
  request as requestApi,
  requestUrl as requestUrlApi,
  requireApiVersion,
  resolveSubpath,
  sanitizeHTMLToDom,
  stripHeading,
  stripHeadingForLink,
  stringifyYaml,
  type DebouncedFunction,
  type Debouncer,
  type RequestUrlError,
  type RequestUrlParam,
  type RequestUrlResponse,
  type RequestUrlResponsePromise,
} from "../core/ApiUtils";

export type {
  DebouncedFunction,
  Debouncer,
  RequestUrlError,
  RequestUrlParam,
  RequestUrlResponse,
  RequestUrlResponsePromise,
} from "../core/ApiUtils";

export interface ObsidianPluginModule {
  App: typeof App;
  Component: typeof Component;
  Events: typeof Events;
  Plugin: typeof Plugin;
  PluginSettingTab: typeof PluginSettingTab;
  Notice: typeof Notice;
  Modal: typeof Modal;
  Menu: typeof Menu;
  MenuItem: typeof MenuItem;
  MenuSeparator: typeof MenuSeparator;
  SettingTab: typeof SettingTab;
  Setting: typeof Setting;
  ValueComponent: typeof ValueComponent;
  AbstractTextComponent: typeof AbstractTextComponent;
  TextAreaComponent: typeof TextAreaComponent;
  SliderComponent: typeof SliderComponent;
  SearchComponent: typeof SearchComponent;
  SecretComponent: typeof SecretComponent;
  ProgressBarComponent: typeof ProgressBarComponent;
  MomentFormatComponent: typeof MomentFormatComponent;
  ExtraButtonComponent: typeof ExtraButtonComponent;
  ColorComponent: typeof ColorComponent;
  SettingGroup: typeof SettingGroup;
  BaseComponent: typeof BaseComponent;
  ButtonComponent: typeof ButtonComponent;
  DropdownComponent: typeof DropdownComponent;
  TextComponent: typeof TextComponent;
  ToggleComponent: typeof ToggleComponent;
  PopoverSuggest: typeof PopoverSuggest;
  AbstractInputSuggest: typeof AbstractInputSuggest;
  SuggestModal: typeof SuggestModal;
  FuzzySuggestModal: typeof FuzzySuggestModal;
  EditorSuggest: typeof EditorSuggestClass;
  Editor: typeof Editor;
  editorEditorField: typeof editorEditorField;
  editorInfoField: typeof editorInfoField;
  editorLivePreviewField: typeof editorLivePreviewField;
  editorViewField: typeof editorViewField;
  livePreviewState: typeof livePreviewState;
  MarkdownRenderer: typeof MarkdownRenderer;
  RenderContext: typeof RenderContext;
  MarkdownPreviewRenderer: typeof MarkdownPreviewRenderer;
  MarkdownPreviewSection: typeof MarkdownPreviewSection;
  MarkdownPreviewView: typeof MarkdownPreviewView;
  MarkdownRenderChild: typeof MarkdownRenderChild;
  View: typeof View;
  ItemView: typeof ItemView;
  FileView: typeof FileView;
  EditableFileView: typeof EditableFileView;
  TextFileView: typeof TextFileView;
  MarkdownView: typeof MarkdownView;
  TAbstractFile: typeof TAbstractFile;
  TFile: typeof TFile;
  TFolder: typeof TFolder;
  Vault: typeof Vault;
  CapacitorAdapter: typeof CapacitorAdapter;
  FileSystemAdapter: typeof FileSystemAdapter;
  FileManager: typeof FileManager;
  MetadataCache: typeof MetadataCache;
  iterateCacheRefs: typeof iterateCacheRefs;
  iterateRefs: typeof iterateRefs;
  SecretStorage: typeof SecretStorage;
  WorkspaceLeaf: typeof WorkspaceLeaf;
  Workspace: typeof Workspace;
  WorkspaceContainer: typeof WorkspaceContainer;
  WorkspaceFloating: typeof WorkspaceFloating;
  WorkspaceItem: typeof WorkspaceItem;
  WorkspaceParent: typeof WorkspaceParent;
  WorkspaceRibbon: typeof WorkspaceRibbon;
  WorkspaceRoot: typeof WorkspaceRoot;
  WorkspaceSidedock: typeof WorkspaceSidedock;
  WorkspaceSplit: typeof WorkspaceSplit;
  WorkspaceTabs: typeof WorkspaceTabs;
  WorkspaceWindow: typeof WorkspaceWindow;
  ViewRegistry: typeof ViewRegistry;
  Scope: typeof Scope;
  Keymap: typeof Keymap;
  Platform: typeof Platform;
  moment: typeof moment;
  prepareQuery: typeof prepareQuery;
  fuzzySearch: typeof fuzzySearch;
  prepareFuzzySearch: typeof prepareFuzzySearch;
  prepareSimpleSearch: typeof prepareSimpleSearch;
  renderMatches: typeof renderMatches;
  renderResults: typeof renderResults;
  sortSearchResults: typeof sortSearchResults;
  addIcon: typeof addIcon;
  getIcon: typeof getIcon;
  getIconIds: typeof getIconIds;
  removeIcon: typeof removeIcon;
  apiVersion: typeof apiVersion;
  arrayBufferToBase64: typeof arrayBufferToBase64;
  arrayBufferToHex: typeof arrayBufferToHex;
  base64ToArrayBuffer: typeof base64ToArrayBuffer;
  finishRenderMath: typeof finishRenderMath;
  getAllTags: typeof getAllTags;
  getBlobArrayBuffer: typeof getBlobArrayBuffer;
  getFrontMatterInfo: typeof getFrontMatterInfo;
  getLanguage: typeof getLanguage;
  getLinkpath: typeof getLinkpath;
  hexToArrayBuffer: typeof hexToArrayBuffer;
  htmlToMarkdown: typeof htmlToMarkdown;
  loadMathJax: typeof loadMathJax;
  loadMermaid: typeof loadMermaid;
  loadPdfJs: typeof loadPdfJs;
  loadPrism: typeof loadPrism;
  parseFrontMatterAliases: typeof parseFrontMatterAliases;
  parseFrontMatterEntry: typeof parseFrontMatterEntry;
  parseFrontMatterStringArray: typeof parseFrontMatterStringArray;
  parseFrontMatterTags: typeof parseFrontMatterTags;
  parseLinktext: typeof parseLinktext;
  parseYaml: typeof parseYaml;
  renderMath: typeof renderMath;
  requireApiVersion: typeof requireApiVersion;
  resolveSubpath: typeof resolveSubpath;
  sanitizeHTMLToDom: typeof sanitizeHTMLToDom;
  stripHeading: typeof stripHeading;
  stripHeadingForLink: typeof stripHeadingForLink;
  stringifyYaml: typeof stringifyYaml;
  setIcon: typeof setIcon;
  setTooltip: typeof setTooltip;
  displayTooltip: typeof displayTooltip;
  HoverPopover: typeof HoverPopover;
  PopoverState: typeof PopoverState;
  normalizePath(path: string): string;
  requestUrl(param: string | RequestUrlParam): RequestUrlResponsePromise;
  request(param: string | RequestUrlParam): Promise<string>;
  debounce<T extends unknown[], V>(fn: (...args: T) => V, timeout?: number, resetTimer?: boolean): Debouncer<T, V>;
}

export function createObsidianPluginModule(app: App): ObsidianPluginModule {
  return {
    App,
    Component,
    Events,
    Plugin,
    PluginSettingTab,
    Notice,
    Modal,
    Menu,
    MenuItem,
    MenuSeparator,
    SettingTab,
    AbstractTextComponent,
    BaseComponent,
    ButtonComponent,
    ColorComponent,
    DropdownComponent,
    ExtraButtonComponent,
    MomentFormatComponent,
    ProgressBarComponent,
    SearchComponent,
    SecretComponent,
    Setting,
    SettingGroup,
    SliderComponent,
    TextAreaComponent,
    TextComponent,
    ToggleComponent,
    ValueComponent,
    PopoverSuggest,
    AbstractInputSuggest,
    SuggestModal,
    FuzzySuggestModal,
    EditorSuggest: EditorSuggestClass,
    Editor,
    editorEditorField,
    editorInfoField,
    editorLivePreviewField,
    editorViewField,
    livePreviewState,
    MarkdownRenderer,
    RenderContext,
    MarkdownPreviewRenderer,
    MarkdownPreviewSection,
    MarkdownPreviewView,
    MarkdownRenderChild,
    View,
    ItemView,
    FileView,
    EditableFileView,
    TextFileView,
    MarkdownView,
    TAbstractFile,
    TFile,
    TFolder,
    Vault,
    CapacitorAdapter,
    FileSystemAdapter,
    FileManager,
    MetadataCache,
    iterateCacheRefs,
    iterateRefs,
    SecretStorage,
    WorkspaceLeaf,
    Workspace,
    WorkspaceContainer,
    WorkspaceFloating,
    WorkspaceItem,
    WorkspaceParent,
    WorkspaceRibbon,
    WorkspaceRoot,
    WorkspaceSidedock,
    WorkspaceSplit,
    WorkspaceTabs,
    WorkspaceWindow,
    ViewRegistry,
    Scope,
    Keymap,
    Platform,
    moment,
    prepareQuery,
    fuzzySearch,
    prepareFuzzySearch,
    prepareSimpleSearch,
    renderMatches,
    renderResults,
    sortSearchResults,
    addIcon,
    getIcon,
    getIconIds,
    removeIcon,
    apiVersion,
    arrayBufferToBase64,
    arrayBufferToHex,
    base64ToArrayBuffer,
    finishRenderMath,
    getAllTags,
    getBlobArrayBuffer,
    getFrontMatterInfo,
    getLanguage,
    getLinkpath,
    hexToArrayBuffer,
    htmlToMarkdown,
    loadMathJax,
    loadMermaid,
    loadPdfJs,
    loadPrism,
    parseFrontMatterAliases,
    parseFrontMatterEntry,
    parseFrontMatterStringArray,
    parseFrontMatterTags,
    parseLinktext,
    parseYaml,
    renderMath,
    requireApiVersion,
    resolveSubpath,
    sanitizeHTMLToDom,
    stripHeading,
    stripHeadingForLink,
    stringifyYaml,
    setIcon,
    setTooltip,
    displayTooltip,
    HoverPopover,
    PopoverState,
    normalizePath,
    requestUrl: (param) => requestUrlApi(param, app),
    request: (param) => requestApi(param, app),
    debounce,
  };
}

export function setIcon(el: HTMLElement, icon: string): void {
  void renderIcon(el, icon);
}
