<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { Archive } from 'lucide-svelte'
  import { bootstrapOwner, login, type User } from './api'

  export let needsSetup = false
  export let serverError = ''
  const dispatch = createEventDispatcher<{ signedIn: User; retry: void }>()
  let username = ''
  let password = ''
  let confirm = ''
  let busy = false
  let error = ''

  async function submit() {
    error = ''
    if (needsSetup && password !== confirm) { error = 'Passwords do not match.'; return }
    busy = true
    try {
      const result = needsSetup ? await bootstrapOwner(username, password) : await login(username, password)
      dispatch('signedIn', result.user)
      password = ''
      confirm = ''
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    finally { busy = false }
  }
</script>

<main class="auth-screen">
  <section class="auth-card">
    <div class="auth-brand"><div class="brand-mark"><Archive size={20} /></div><strong>stockroom</strong></div>
    <h1>{needsSetup ? 'Create owner account' : 'Sign in'}</h1>
    {#if needsSetup}<p>Set up the first account for this store.</p>{/if}
    {#if serverError}<div class="form-error" role="alert">{serverError} <button class="text-button" type="button" on:click={() => dispatch('retry')}>Try again</button></div>{/if}
    {#if error}<div class="form-error" role="alert">{error}</div>{/if}
    <form on:submit|preventDefault={submit}>
      <label>Username<input autocomplete="username" minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]+" bind:value={username} required /></label>
      <label>Password<input type="password" autocomplete={needsSetup ? 'new-password' : 'current-password'} minlength={needsSetup ? 12 : undefined} bind:value={password} required /></label>
      {#if needsSetup}<label>Confirm password<input type="password" autocomplete="new-password" minlength="12" bind:value={confirm} required /></label>{/if}
      <button class="primary-button" type="submit" disabled={busy || !!serverError}>{busy ? 'Please wait…' : needsSetup ? 'Create owner' : 'Sign in'}</button>
    </form>
  </section>
</main>
