import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

function detectLanguage(req: Request): 'ru' | 'en' {
  // Check cookie first (user preference)
  const cookieHeader = req.headers.get('cookie') || '';
  const langCookie = cookieHeader.match(/lang=(ru|en)/);
  if (langCookie) {
    return langCookie[1] as 'ru' | 'en';
  }

  // Check Accept-Language header
  const acceptLanguage = req.headers.get('accept-language') || '';

  // Check for Russian language
  if (acceptLanguage.includes('ru')) {
    return 'ru';
  }

  // Default to English
  return 'en';
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;
    const isTrainerRoute = pathname.startsWith('/trainer');
    const isLandingRoute = pathname === '/landing';

    // Detect and set language for landing page
    if (isLandingRoute) {
      const lang = detectLanguage(req);
      const response = NextResponse.next();

      // Set lang cookie if not already set
      const cookieHeader = req.headers.get('cookie') || '';
      if (!cookieHeader.includes('lang=')) {
        response.cookies.set('lang', lang, {
          path: '/',
          maxAge: 60 * 60 * 24 * 365, // 1 year
          sameSite: 'lax'
        });
      }

      return response;
    }

    // Root path handling
    if (pathname === '/') {
      // Always redirect to landing for unauthenticated users
      if (!token) {
        return NextResponse.redirect(new URL('/landing', req.url));
      }
      // Redirect trainers to trainer dashboard
      if (token?.role === 'TRAINER') {
        return NextResponse.redirect(new URL('/trainer', req.url));
      }
      // Clients stay on main app (no redirect needed)
    }

    // Protect trainer routes
    if (isTrainerRoute && token?.role !== 'TRAINER') {
      return NextResponse.redirect(new URL('/', req.url));
    }

    return NextResponse.next();
  },
  {
    pages: {
      signIn: '/login',
    },
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;

        // Allow root, login page and landing page without auth
        // Root will be redirected to /landing in middleware function
        if (pathname === '/' || pathname.startsWith('/login') || pathname === '/landing') {
          return true;
        }
        // Require auth for all other pages
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - api routes (they handle their own auth)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - manifest.json (PWA manifest)
     * - public files (images, etc)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.json|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)',
  ],
};
