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
  const userDoc = useMyUser(user && !admin ? uid : null);
  const screen = route({
    authLoading: user === undefined,
    email: user?.email ?? null,
    isAdmin: admin,
    userDoc: user && !admin ? userDoc : null,
  });

  const isPending = screen === 'pending';
  const myJoin = useMyJoinRequest(isPending ? uid : null);
  const group = useGroup(isPending);

  function signIn() {
    setSignInError(null);
    signInWithRedirect(auth, new GoogleAuthProvider()).catch(() =>
      setSignInError("Sign-in didn't work. Please try again."),
    );
  }

  switch (screen) {
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
      return (
        <main class="screen">
          <h1 class="brand">WHITE ICE CREAM BETS</h1>
          <p>Admin page coming soon.</p>
          <button type="button" class="btn link" onClick={doSignOut}>Sign out</button>
        </main>
      );
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
      return (
        <main class="screen">
          <h1 class="brand">WHITE ICE CREAM BETS</h1>
          <p>Hi, {userDoc?.displayName}. Bets are coming soon.</p>
          <button type="button" class="btn link" onClick={() => setShowProfile(true)}>Profile</button>
          <button type="button" class="btn link" onClick={doSignOut}>Sign out</button>
        </main>
      );
  }
}
