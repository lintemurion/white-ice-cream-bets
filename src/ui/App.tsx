import { useEffect, useState } from 'preact/hooks';
import { GoogleAuthProvider, getRedirectResult, signInWithRedirect, signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import { isAdminUser } from '../config';
import { requestToJoin } from '../data/joins';
import { updateMyName } from '../data/profile';
import { useAuthUser, useGroup, useMyJoinRequest, useMyUser } from '../data/subscriptions';
import { route } from './route';
import { SignIn } from './SignIn';
import { ChooseName, defaultName } from './ChooseName';
import { Pending } from './Pending';
import { Blocked } from './Blocked';
import { Profile } from './Profile';
import { HomeContainer } from './HomeContainer';
import { AdminContainer } from './AdminContainer';
import { LoadError } from './LoadError';

const doSignOut = () => void signOut(auth);

export function App() {
  const user = useAuthUser();
  const [signInError, setSignInError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    getRedirectResult(auth).catch(() => setSignInError("Sign-in didn't work. Please try again."));
  }, []);

  const uid = user?.uid ?? null;
  const admin = isAdminUser(user);
  const { data: userDoc, error: userDocError } = useMyUser(user && !admin ? uid : null);
  const screen = route({
    authLoading: user === undefined,
    email: user?.email ?? null,
    isAdmin: admin,
    userDoc: user && !admin ? userDoc : null,
    userDocError,
  });

  const isPending = screen === 'pending';
  const myJoin = useMyJoinRequest(isPending ? uid : null).data;
  const group = useGroup(isPending).data;

  function signIn() {
    setSignInError(null);
    signInWithRedirect(auth, new GoogleAuthProvider()).catch(() =>
      setSignInError("Sign-in didn't work. Please try again."),
    );
  }

  switch (screen) {
    case 'error':
      return <LoadError />;
    case 'loading':
      return <main class="screen"><p>Loading...</p></main>;
    case 'signIn':
      return <SignIn onSignIn={signIn} error={signInError} />;
    case 'chooseName':
      return (
        <ChooseName
          initialName={defaultName(user?.displayName)}
          onSubmit={(name) => requestToJoin(db, uid!, name)}
          onSignOut={doSignOut}
        />
      );
    case 'pending':
      return (
        <Pending
          displayName={userDoc?.displayName ?? ''}
          voterCount={myJoin?.voterCount}
          memberCount={group?.memberCount}
          onSignOut={doSignOut}
        />
      );
    case 'blocked':
      return <Blocked onSignOut={doSignOut} />;
    case 'admin':
      return <AdminContainer onSignOut={doSignOut} />;
    case 'home':
      if (showProfile && userDoc) {
        return (
          <Profile
            displayName={userDoc.displayName}
            onSave={(name) => updateMyName(db, uid!, name)}
            onBack={() => setShowProfile(false)}
            onSignOut={doSignOut}
          />
        );
      }
      return <HomeContainer me={uid!} onProfile={() => setShowProfile(true)} onSignOut={doSignOut} />;
  }
}
