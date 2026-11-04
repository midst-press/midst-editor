import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { i18n } from '../shared/i18n';

// The one place the window title is set (#125). Empty on the opening screen; otherwise the poem's file
// name, or "Untitled" before it has one, and then a flag when the poem has changes that are not saved (on every
// platform, macOS included: Annelyse, GitHub #75 and #113). The flag is apart from the name, so the name stays the
// poem's own everywhere else, the recovery dialog included (#421). "(not saved)" is for an untitled poem with
// edits and after a failed save (main decides, #94); "(unsaved changes)" is for a saved poem's edits not yet saved,
// which nothing shows yet (Annelyse, GitHub #113). App holds them; the route says which screen is showing.
// The title bar library sets document.title with it, and the native window title follows that.
export type TitleFlag = 'notSaved' | 'unsavedChanges';

export default function WindowTitle({
  filename,
  flag,
}: {
  filename: string;
  flag: TitleFlag | null;
}) {
  const { pathname } = useLocation();
  const name = filename || i18n._('file.untitled');
  let title = name;
  if (flag === 'notSaved') title = i18n._('window.notSaved', { name });
  if (flag === 'unsavedChanges')
    title = i18n._('window.unsavedChanges', { name });
  if (pathname === '/') title = '';
  useEffect(() => {
    window.electron.titlebar.updateTitle(title);
  }, [title]);
  return null;
}
