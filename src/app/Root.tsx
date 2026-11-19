// Which screen is showing. No server and no build-time routes: the part of the address after "#" decides.
import { useEffect } from 'react';
import { t } from '../i18n';
import { useApp } from './app';
import { Backdrop } from './components/Backdrop';
import { downloadStory } from './files';
import { go, useRoute } from './router';
import { Character } from './screens/Character';
import { CharacterNew } from './screens/CharacterNew';
import { Home } from './screens/Home';
import { Journal } from './screens/Journal';
import { MapScreen } from './screens/MapScreen';
import { People } from './screens/People';
import { PersonProfile } from './screens/Person';
import { Play } from './screens/Play';
import { Recap } from './screens/Recap';
import { Settings } from './screens/Settings';
import { Usage } from './screens/Usage';
import { Welcome } from './screens/Welcome';
import { WorldNew } from './screens/WorldNew';
import { Worlds } from './screens/Worlds';
import { Icon } from './ui';

const IN_STORY = new Set(['play', 'people', 'person', 'character', 'journal', 'map', 'recap']);

/** The backdrop, once, behind whichever screen is showing. */
export function App() {
  return (
    <>
      <Backdrop />
      <Screen />
      <SaveAlert />
    </>
  );
}

/** The last save did not go through. Said on every screen until one does, with a way to get the story out. */
function SaveAlert() {
  const a = useApp();
  if (!a.saveProblem) return null;
  const story = a.session?.story;
  return (
    <div className="save-alert alert alert-err" role="alert">
      <Icon name="warn" />
      <div className="grow"><b>{t('Not saved')}</b><p>{a.saveProblem}</p></div>
      {story && <button className="btn btn-fit" onClick={() => void downloadStory(story.id, story.title)}><Icon name="download" size={18} />{t('Export the story')}</button>}
    </div>
  );
}

function Screen() {
  const a = useApp();
  const route = useRoute();
  const needsStory = IN_STORY.has(route.name);
  const mustWelcome = a.ready && !a.settings.onboarded && route.name !== 'welcome';

  useEffect(() => {
    if (!a.ready) return;
    if (mustWelcome) { go('welcome', true); return; }
    if (needsStory && !a.session) {
      // After a reload the last story played is reopened; with no stories, back to the list.
      // A story that cannot be opened sends the player to the list, which says why.
      const last = a.stories[0];
      if (!last || !a.openStory(last.id)) go('', true);
    }
  }, [a, a.ready, a.session, mustWelcome, needsStory, a.stories]);

  if (!a.ready || mustWelcome || (needsStory && !a.session)) return null;

  switch (route.name) {
    case 'welcome': return <Welcome />;
    case 'play': return <Play />;
    case 'people': return <People />;
    case 'person': return <PersonProfile id={route.arg ?? ''} view={route.query.get('view') === 'history' ? 'history' : 'profile'} />;
    case 'character': return <Character tab={route.arg ?? 'sheet'} />;
    case 'journal': return <Journal tab={route.arg ?? 'threads'} />;
    case 'map': return <MapScreen level={route.arg} />;
    case 'recap': return <Recap />;
    case 'settings': return <Settings tab={route.arg ?? 'app'} />;
    case 'usage': return <Usage />;
    case 'worlds': return <Worlds pick={route.query.has('pick')} />;
    case 'world-new': return <WorldNew id={route.arg} step={route.query.get('step')} />;
    case 'character-new': return <CharacterNew worldId={route.arg ?? ''} auto={route.query.get('auto')} />;
    default: return <Home />;
  }
}
