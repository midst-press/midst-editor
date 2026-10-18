import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// The one place the window title is set (#125). Empty on the opening screen; otherwise the poem's file
// name, or "Untitled" before it has one. App holds the name; the route says which screen is showing.
// The title bar library sets document.title with it, and the native window title follows that.
export default function WindowTitle({ filename }: { filename: string }) {
  const { pathname } = useLocation();
  const title = pathname === '/' ? '' : filename || 'Untitled';
  useEffect(() => {
    window.electron.titlebar.updateTitle(title);
  }, [title]);
  return null;
}
