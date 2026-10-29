import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { i18n } from '../shared/i18n';

// The one place the window title is set (#125). Empty on the opening screen; otherwise the poem's file
// name, or "Untitled" before it has one, followed by "(not saved)" while a failed save has left it unsaved
// (on every platform, macOS included: Annelyse, GitHub #75; main decides, #94). App holds both; the route says which screen is showing.
// The title bar library sets document.title with it, and the native window title follows that.
export default function WindowTitle({
  filename,
  notSaved,
}: {
  filename: string;
  notSaved: boolean;
}) {
  const { pathname } = useLocation();
  const name = filename || i18n._('file.untitled');
  let title = notSaved ? i18n._('window.notSaved', { name }) : name;
  if (pathname === '/') title = '';
  useEffect(() => {
    window.electron.titlebar.updateTitle(title);
  }, [title]);
  return null;
}
