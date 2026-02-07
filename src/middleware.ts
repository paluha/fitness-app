import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;
    const isTrainerRoute = pathname.startsWith('/trainer');
    const isLandingRoute = pathname === '/landing';

    // Allow landing page without auth
    if (isLandingRoute) {
      return NextResponse.next();
    }

    // Redirect unauthenticated users from root to landing
    if (pathname === '/' && !token) {
      return NextResponse.redirect(new URL('/landing', req.url));
    }

    // Redirect trainers to trainer dashboard, clients to main app
    if (pathname === '/') {
      if (token?.role === 'TRAINER') {
        return NextResponse.redirect(new URL('/trainer', req.url));
      }
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

        // Allow login page and landing page without auth
        if (pathname.startsWith('/login') || pathname === '/landing') {
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
