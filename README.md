# Kwado (Prepare)

A React hook that unifies **Zod** schema validation, **react-hook-form** state management, and **Oku** HTTP submission into one concise, declarative API - with an extensible response-handler pipeline that keeps app-specific logic (toasts, error mappers, redirects) fully under your control.

---

## Why does this exist?

Zod and react-hook-form are individually excellent libraries, but combining them for a typical form-with-submission always produces the same boilerplate: wire the resolver, write a submit handler, call `handleSubmit`, check the response status, branch into success/error paths. Do this across dozens of forms in a project and you have a maintenance problem - inconsistent patterns, duplicated branching, and scattered HTTP logic.

`kwado` eliminates that by treating the full lifecycle - **validation → submission → response routing** — as a single, composable unit.

---

## The problem in plain code

Here is a login form written with the three libraries used separately:

```tsx
import { useForm }        from 'react-hook-form';
import { zodResolver }    from '@hookform/resolvers/zod';
import { z }              from 'zod';
import { post }           from '@sirmekus/oku';

// 1. Schema defined once …
const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
});

function LoginForm() {
  // 2. … but the resolver must be wired manually on every form
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });

  const { setValue, setError, reset } = form;

  // 3. Submit handler written by hand every time
  const handleSubmit = async (data: z.infer<typeof loginSchema>) => {
    let response;
    try {
      response = await post({ url: '/api/auth/login', data, method: 'POST' });
    } catch (err) {
      // oku rejects on non-2xx — have to catch and re-shape
      response = err;
    }

    // 4. Status branching duplicated across every form
    if (response.status === 'success') {
      // For instance,
      toast.success(response.data.message);
      router.push('/dashboard');
    } else {
      if (response.statusCode === 422) {
        doSomething(response.data, setError);
      } else {
        toast.error(response.data?.message ?? 'Login failed');
      }
    }
  };

  // 5. handleSubmit wrapper required every time
  return (
    <form onSubmit={form.handleSubmit(handleSubmit)}>
      <input {...form.register('email')} />
      <input {...form.register('password')} type="password" />
      <button disabled={form.formState.isSubmitting}>Log in</button>
    </form>
  );
}
```

That is **five distinct wiring steps** repeated on every form. The branching logic is particularly painful — it is ad-hoc, hard to reuse, and easily diverges between forms.

---

## The same form with `kwado`

```tsx
import { useZodForm, whenStatusCode, whenSuccess, whenError } from '@sirmekus/kwado';
import { z } from 'zod';

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
});

function LoginForm() {
  const { register, onSubmit, formState: { errors, isSubmitting } } = useZodForm(
    loginSchema,
    {
      endpoint: '/api/auth/login',
      responseHandlers: [
        whenStatusCode(422, (res, { setError }) => applyLaravelErrors(res.data, setError)),
        whenSuccess((res) => { toast.success(res.data.message); router.push('/dashboard'); }),
        whenError((res)   => toast.error(res.data?.message ?? 'Login failed')),
      ],
    },
  );

  return (
    <form onSubmit={onSubmit}>
      <input {...register('email')} />
      <input {...register('password')} type="password" />
      <button disabled={isSubmitting}>Log in</button>
    </form>
  );
}
```

**What disappeared:**

| Eliminated boilerplate | How |
|---|---|
| `resolver: zodResolver(schema)` | Wired automatically from the schema argument |
| `form.handleSubmit(handler)` | `onSubmit` is returned pre-bound |
| `try/catch` around oku | Normalised internally; both HTTP errors and network failures reach the pipeline |
| Manual `if/else` on `response.status` | Replaced by the `responseHandlers` pipeline |
| Closing over `setValue`, `setError`, `reset` | Available as `helpers` in every callback |

The schema is the single source of truth. TypeScript infers the field types from it automatically — no `z.infer<typeof schema>` needed at the call site.

---

## Installation

```bash
npm install @sirmekus/kwado
# or
pnpm add @sirmekus/kwado
# or
bun add @sirmekus/kwado
```

Install peer dependencies if not already present:

```bash
npm install zod react-hook-form @hookform/resolvers @sirmekus/oku
```

---

## Quick start

```tsx
import { useZodForm, whenSuccess, whenError } from '@sirmekus/kwado';
import { z } from 'zod';

const contactSchema = z.object({
  name:    z.string().min(1, 'Name is required'),
  email:   z.string().email(),
  message: z.string().min(10),
});

function ContactForm() {
  const { register, onSubmit, formState: { errors, isSubmitting } } = useZodForm(
    contactSchema,
    {
      endpoint: '/api/contact',
      responseHandlers: [
        whenSuccess(() => alert('Message sent!')),
        whenError((res) => alert(res.data?.message)),
      ],
    },
  );

  return (
    <form onSubmit={onSubmit}>
      <input {...register('name')} />
      {errors.name && <p>{errors.name.message}</p>}

      <input {...register('email')} />
      {errors.email && <p>{errors.email.message}</p>}

      <textarea {...register('message')} />
      {errors.message && <p>{errors.message.message}</p>}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
}
```

---

## Core concept: the response-handler pipeline

Instead of writing `if/else` branches inside a submit handler, you declare an ordered list of handlers. Each one has two parts:

- **`detect`** — a predicate that inspects the response and returns `true` if this handler owns it.
- **`handle`** — an async-capable function that reacts to the response.

The pipeline walks the list in order. The **first handler whose `detect` returns `true`** is executed and the rest — including the fallback `onSuccess` / `onError` — are skipped. This makes the response logic explicit, isolated, and easy to reorder or extract into reusable modules.

```
HTTP response
      │
      ▼
┌─────────────┐  detect → false
│  handler[0] │──────────────────►  skip
└─────────────┘
      │ detect → true
      ▼
   handle()   ◄── setError, reset, redirect, toast, anything
      │
     end   (handlers[1..n] and onSuccess/onError are not called)
```

---

## Handler factory functions

All factories are exported from the package and accept an optional async `handle` function that receives the response object and a `helpers` object.

### `whenStatusCode(code, handle)`

Fires when `response.statusCode` equals `code`.

```ts
// Map 422 validation errors back onto form fields (Laravel, Django, etc.)
whenStatusCode(422, (res, { setError }) => applyMyServerErrors(res.data, setError))

// Redirect on session expiry
whenStatusCode(401, () => router.push('/login'))

// Show a specific message for conflict errors
whenStatusCode(409, (res) => toast.warning(res.data.message))
```

### `whenStatusRange(min, max, handle)`

Fires when `min ≤ response.statusCode ≤ max`. Useful for class-level handling.

```ts
// Report all 5xx errors to your monitoring service
whenStatusRange(500, 599, (res) => Sentry.captureMessage(res.data?.message))
```

### `whenSuccess(handle)`

Fires when `response.status === 'success'`.

```ts
whenSuccess((res) => {
  toast.success(res.data.message ?? 'Done!');
  router.push('/dashboard');
})
```

### `whenError(handle)`

Fires when `response.status === 'error'`.

```ts
whenError((res) => toast.error(res.data?.message ?? 'Something went wrong'))
```

### `whenResponse(detect, handle)`

Fully custom predicate. Use this when the other factories cannot express what you need — for example, matching on response body content.

```ts
// Handle a soft "action required" response that arrives as a 200
whenResponse(
  (res) => res.data?.action === 'TWO_FACTOR_REQUIRED',
  ()    => router.push('/auth/2fa'),
)

// Handle business-logic flags in the response body
whenResponse(
  (res) => res.data?.requiresEmailVerification === true,
  (res, { reset }) => { reset(); router.push('/verify-email'); },
)
```

### `always(handle)`

Unconditional catch-all. Always fires. Place it **last** in the list.

```ts
responseHandlers: [
  whenStatusCode(422, applyErrors),
  whenSuccess(redirectToDashboard),
  always((_, { reset }) => reset()),  // clean up the form no matter what
]
```

---

## `useZodForm` API reference

```ts
function useZodForm<T extends ZodRawShape>(
  schema:  ZodObject<T>,
  options: UseZodFormOptions<z.infer<ZodObject<T>>>,
)
```

### Options

| Option | Type | Description |
|---|---|---|
| `endpoint` | `string` | URL for the built-in oku HTTP call. Ignored when `submit` is provided. |
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | HTTP method. Defaults to `'POST'`. Ignored when `submit` is provided. |
| `defaultValues` | `Partial<TForm>` | Initial field values passed to react-hook-form. |
| `transform` | `(data: TForm) => unknown` | Reshape the validated payload before it is sent. |
| `responseHandlers` | `ResponseHandler[]` | Ordered response-handler pipeline (see above). |
| `onSuccess` | `(res, helpers) => void` | Fallback called on success when no handler matched. |
| `onError` | `(err, helpers) => void` | Fallback called on error when no handler matched, or on network failure. |
| `submit` | `(payload) => Promise<ResponseLike>` | Replace oku with any custom HTTP function. |
| `requestOptions` | `Record<string, unknown>` | Extra options forwarded verbatim to oku (headers, credentials, etc.). |
| `onBeforeSubmit` | `() => void` | Called immediately before submission starts. |
| `onAfterSubmit` | `() => void` | Called immediately after submission ends (always paired with `onBeforeSubmit`). |

### Return value

`useZodForm` spreads the entire return value of react-hook-form's `useForm` onto its own return object, so **every function and property that `useForm` exposes is available directly** from `useZodForm` — no secondary form reference needed.

#### react-hook-form surface (all available, unchanged)

| Property / method | Description |
|---|---|
| `register(name, options?)` | Register a field and return its ref, `onChange`, `onBlur`, and `name` props. |
| `control` | `Controller` / `useController` integration object. |
| `formState` | Reactive state bag: `errors`, `isSubmitting`, `isValid`, `isDirty`, `dirtyFields`, `touchedFields`, `isLoading`, and more. |
| `watch(name?)` | Subscribe to field value changes. Returns the current value or an object of all values. |
| `getValues(name?)` | Read field values without subscribing to re-renders. |
| `setValue(name, value, options?)` | Imperatively set a field value. |
| `setError(name, error, options?)` | Manually set a field error (e.g. from a server response). |
| `clearErrors(name?)` | Clear one or all field errors. |
| `reset(values?, options?)` | Reset the form to its default values (or supplied values). |
| `resetField(name, options?)` | Reset a single field. |
| `trigger(name?)` | Manually trigger validation on one or all fields. |
| `setFocus(name, options?)` | Programmatically focus a registered field. |
| `unregister(name, options?)` | Unregister a field and optionally remove its value. |
| `getFieldState(name)` | Read the dirty/invalid/error state of a specific field. |
| `handleSubmit(fn, onError?)` | Wrap a custom handler with react-hook-form's validation gate. Not needed in normal usage since `onSubmit` is pre-bound, but available if you need a second submission path. |

All `formState` properties react-hook-form documents - `errors`, `isSubmitting`, `isValid`, `isDirty`, `isLoading`, `isSubmitSuccessful`, `submitCount`, `dirtyFields`, `touchedFields` - are accessible through `formState` exactly as they are in plain react-hook-form.

```tsx
const {
  register,
  control,
  watch,
  setValue,
  getValues,
  setError,
  clearErrors,
  reset,
  trigger,
  setFocus,
  formState: { errors, isSubmitting, isValid, isDirty },
  onSubmit,   // ← added by useZodForm
  helpers,    // ← added by useZodForm
} = useZodForm(schema, options);
```

#### Added by `useZodForm`

| Property | Description |
|---|---|
| `onSubmit` | Pre-bound handler for `<form onSubmit={onSubmit}>`. Runs validation, submission, and the full pipeline. `formState.isSubmitting` is `true` for its entire async duration. |
| `helpers` | A curated object — `{ setValue, setError, reset, getValues, watch, trigger, clearErrors }` — forwarded into every `responseHandlers` callback and `onSuccess` / `onError`, so you can imperatively update the form from inside response logic without closing over the full form object. |

---

## Recipes

### Pre-filling a form for editing

```tsx
const { register, onSubmit } = useZodForm(userSchema, {
  endpoint:      `/api/users/${userId}`,
  method:        'PUT',
  defaultValues: existingUser,  // pre-populates every field
  responseHandlers: [
    whenSuccess(() => toast.success('Profile updated')),
    whenError((res) => toast.error(res.data?.message)),
  ],
});
```

### Transforming the payload before submission

```tsx
const { register, onSubmit } = useZodForm(signupSchema, {
  endpoint:  '/api/auth/signup',
  transform: (data) => ({
    ...data,
    // strip the UI-only confirmation field
    passwordConfirmation: undefined,
    // inject a device fingerprint
    deviceId: getDeviceFingerprint(),
  }),
  responseHandlers: [
    whenStatusCode(422, (res, { setError }) => applyLaravelErrors(res.data, setError)),
    whenSuccess(() => router.push('/dashboard')),
  ],
});
```

### Global loading indicator with `onBeforeSubmit` / `onAfterSubmit`

```tsx
const { register, onSubmit } = useZodForm(schema, {
  endpoint:       '/api/data',
  onBeforeSubmit: () => globalLoadingStore.setLoading(true),
  onAfterSubmit:  () => globalLoadingStore.setLoading(false),
  onSuccess:      () => toast.success('Saved'),
});
```

### File uploads

oku automatically switches from JSON to `FormData` when any field value is a `File` or `FileList`, so no extra configuration is needed:

```tsx
const uploadSchema = z.object({
  title: z.string(),
  file:  z.instanceof(File),
});

const { register, onSubmit } = useZodForm(uploadSchema, {
  endpoint: '/api/upload',
  method:   'POST',
  // oku detects the File and sends multipart/form-data automatically
  responseHandlers: [
    whenSuccess((res) => toast.success(`Uploaded: ${res.data.filename}`)),
    whenError((res)   => toast.error(res.data?.message)),
  ],
});
```

### Custom HTTP client (bypass oku entirely)

Use `submit` to plug in any async function — fetch, axios, GraphQL, a mock — as long as it returns a `ResponseLike` object.

```tsx
const { register, onSubmit } = useZodForm(schema, {
  submit: async (payload) => {
    const res = await axios.post('/api/login', payload);
    return {
      status:     res.status < 400 ? 'success' : 'error',
      statusCode: res.status,
      data:       res.data,
    };
  },
  responseHandlers: [
    whenSuccess(() => router.push('/dashboard')),
    whenError((res) => toast.error(res.data?.message)),
  ],
});
```

### Reusable handler modules

Because handlers are plain objects (`{ detect, handle }`), you can define them once and share them across forms:

```ts
// lib/formHandlers.ts
import { whenStatusCode, whenStatusRange } from '@sirmekus/kwado';

export const handleValidationErrors = (setError) =>
  whenStatusCode(422, (res) => applyLaravelErrors(res.data, setError));

export const reportServerErrors =
  whenStatusRange(500, 599, (res) => Sentry.captureMessage(res.data?.message));

export const handleSessionExpiry =
  whenStatusCode(401, () => router.push('/login'));
```

```tsx
// In any form — setError is received as a helper argument, not closed over
import { reportServerErrors, handleSessionExpiry } from '@/lib/formHandlers';

const { register, onSubmit } = useZodForm(schema, {
  endpoint: '/api/resource',
  responseHandlers: [
    whenStatusCode(422, (res, { setError }) => applyLaravelErrors(res.data, setError)),
    reportServerErrors,
    handleSessionExpiry,
    whenSuccess(() => toast.success('Saved!')),
  ],
});
```

---

## TypeScript

The hook is fully generic. Field names, types, and `formState.errors` are all inferred from your Zod schema with no manual annotation required.

```ts
const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
});

const { register, formState: { errors } } = useZodForm(schema, { ... });

// errors.email     — fully typed, no 'any'
// errors.password  — fully typed
// errors.typo      — TypeScript error ✗
```

You can also type the response data for full inference inside handlers by passing it as the second type argument:

```ts
interface LoginResponse {
  token:   string;
  user:    { id: number; name: string };
  message: string;
}

const { onSubmit } = useZodForm<typeof loginSchema['shape'], LoginResponse>(loginSchema, {
  endpoint: '/api/auth/login',
  responseHandlers: [
    whenSuccess<LoginResponse>((res) => {
      // res.data is LoginResponse — fully typed
      localStorage.setItem('token', res.data.token);
      console.log(res.data.user.name);
    }),
  ],
});
```

---

## How the response pipeline handles oku's rejection model

oku resolves on 2xx and **rejects** on non-2xx HTTP responses and network failures. `kwado` catches both cases transparently:

- **Non-2xx HTTP response** — oku rejects with a `ResponseObject`. The hook detects the shape (`status`, `statusCode`, `data`) and feeds it through the `responseHandlers` pipeline as normal, so `whenStatusCode(422, ...)`, `whenError(...)`, etc. all work without any extra handling on your part.
- **Network failure** (connection refused, timeout) — the error is a plain `Error` object with no `status` / `statusCode`. The hook detects this and calls `onError` directly, bypassing the pipeline.

You never need to write a `try/catch` around `useZodForm`.

---

## Peer dependencies

| Package | Version |
|---|---|
| `react` | `>=18.0.0` |
| `react-hook-form` | `>=7.0.0` |
| `@hookform/resolvers` | `>=3.0.0` |
| `zod` | `>=3.0.0` |
| `@sirmekus/oku` | `>=1.0.0` |

---

## Building from source

```bash
npm install
npm run build      # emits dist/ (CJS + ESM + .d.ts)
npm run typecheck  # tsc --noEmit
```

The build uses [tsup](https://tsup.egoist.dev/) and produces:

- `dist/index.js` — CommonJS
- `dist/index.mjs` — ESM
- `dist/index.d.ts` — TypeScript declarations

---

## License

MIT
