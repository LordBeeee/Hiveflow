import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { NodeCategory, NodeType, Point } from '@hiveflow/shared';
import { nodeCatalog, type NodeCatalogEntry } from '../../nodes/catalog';
import { Icon } from '../Icons';
import { rankNodes, type CategoryFilter } from './rankNodes';
import './NodePicker.css';

const categoryOrder: NodeCategory[] = [
  'Image',
  'Video',
  'Audio',
  'Text',
  'Utilities',
];
export function NodePicker({
  onInsert,
  onClose,
  returnFocus,
  catalog = nodeCatalog,
  anchor,
  compatibleOnly = false,
}: {
  onInsert: (type: NodeType) => void;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement>;
  catalog?: readonly NodeCatalogEntry[];
  anchor?: Point;
  compatibleOnly?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('All');
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = rankNodes(catalog, query, category);
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  const categories = categoryOrder.filter((category) =>
    catalog.some((node) => node.category === category),
  );
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    input.current?.focus();
    return () => {
      element.close();
      returnFocus.current?.focus();
    };
  }, [returnFocus]);
  useEffect(() => {
    dialog.current
      ?.querySelector('[role="option"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, query, category]);
  return (
    <dialog
      ref={dialog}
      className="node-picker"
      style={
        anchor
          ? {
              left: `clamp(12px, ${anchor.x}px, calc(100vw - 380px))`,
              top: `clamp(82px, ${anchor.y}px, calc(100dvh - 430px))`,
            }
          : undefined
      }
      aria-label="Add a node"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== dialog.current) return;
        const bounds = dialog.current.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (results.length)
            setActive(
              (activeIndex +
                (event.key === 'ArrowDown' ? 1 : results.length - 1)) %
                results.length,
            );
          input.current?.focus();
        } else if (event.key === 'Enter' && event.target === input.current) {
          event.preventDefault();
          if (results[activeIndex]) onInsert(results[activeIndex].type);
        } else if (event.key === 'Tab') {
          const focusable = [
            ...dialog.current!.querySelectorAll<HTMLElement>('input, button'),
          ];
          const first = focusable[0],
            last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="node-picker-search">
        <Icon name="search" size={19} />
        <input
          ref={input}
          role="combobox"
          aria-label="Search nodes"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={
            results.length
              ? `${listId}-${results[activeIndex].type}`
              : undefined
          }
          placeholder="Search nodes…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
        />
        <button
          aria-label="Close node picker"
          title="Close (Esc)"
          onClick={onClose}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div
        className="node-picker-categories"
        role="group"
        aria-label="Node categories"
      >
        {(['All', ...categories] as CategoryFilter[]).map((item) => (
          <button
            key={item}
            aria-pressed={category === item}
            onClick={() => {
              setCategory(item);
              setActive(0);
              input.current?.focus();
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="node-picker-section">
        {compatibleOnly ? 'COMPATIBLE NODES' : 'NODES'}
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label="Node types"
        className="node-picker-list"
      >
        {results.map((node, index) => (
          <li
            key={node.type}
            id={`${listId}-${node.type}`}
            role="option"
            aria-label={node.label}
            aria-selected={index === activeIndex}
            title={node.description}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onInsert(node.type)}
          >
            <span
              className={`node-picker-icon category-${node.category.toLowerCase()}`}
            >
              <Icon name={node.icon} size={21} />
            </span>
            <span className="node-picker-label">
              <strong>{node.label}</strong>
              <small>{node.category}</small>
            </span>
            {node.isNew && <span className="node-picker-new">New</span>}
            <Icon name="plus" size={15} />
          </li>
        ))}
      </ul>
      {!results.length && (
        <p className="node-picker-empty" role="status">
          No nodes match "{query}"
        </p>
      )}
      <footer className="node-picker-footer">
        <span>
          <kbd>N</kbd> Open
        </span>
        <span>
          <kbd>↑↓</kbd> Navigate
        </span>
        <span>
          <kbd>⏎</kbd> Insert
        </span>
      </footer>
    </dialog>
  );
}
