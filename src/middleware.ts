import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const isTrainerRoute = req.nextUrl.pathname.startsWith('/trainer');

    // Redirect trainers to trainer dashboard, clients to main app
    if (req.nextUrl.pathname === '/') {
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
        // Allow login page without auth
        if (req.nextUrl.pathname.startsWith('/login')) {
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
