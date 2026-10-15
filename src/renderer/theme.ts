import { ThemeOptions } from '@mui/material';

const themeObj: ThemeOptions = {
  typography: {
    // button: {
    //   textTransform: 'none',
    //   fontFamily: `"Nunito Sans", "Futura", "Helvetica", sans-serif `,
    // },
    fontFamily: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif`,
    body1: {
      letterSpacing: '0.00938em',
    },
  },
  palette: {
    primary: {
      main: '#FFCED4',
      dark: '#FFA4B9',
    },
    background: {
      default: '#FFF5EE',
    },
    action: {
      selected: '#FFA4B9',
      hover: '#FFDDE1',
    },
    secondary: {
      main: '#FFA4B9',
      contrastText: '#ffffff',
    },
  },
  // overrides: {
  //   MuiToggleButton: {
  //     root: {
  //       '&$selected': {
  //         backgroundColor: 'rgba(255,145,175,0.7)',
  //         '&:hover': {
  //           backgroundColor: 'rgba(255,145,175,0.7)',
  //         },
  //       },
  //       '&:hover': {
  //         backgroundColor: 'rgba(255,145,175,0.3)',
  //       },
  //     },
  //   },
  // },
  // components: {
  //   MuiCssBaseline: {
  //     styleOverrides: `
  //       @font-face {
  //         font-family: 'Nunito Sans','Futura','Helvetica',sans-serif;
  //         src: local('Raleway'), local('Raleway-Regular'), url(${RalewayWoff2}) format('woff2');
  //       }
  //     `,
  //   },
  // },
};

export default themeObj;

// The dark scheme (GitHub #16): the same pinks, on a warm near-black, with dark text where the light
// scheme put white on pink. A proposal for Annelyse to adjust; a test holds every text and control
// colour in it to WCAG AA contrast.
export const darkThemeObj: ThemeOptions = {
  typography: themeObj.typography,
  palette: {
    mode: 'dark',
    primary: {
      main: '#FFCED4',
      dark: '#FFA4B9',
    },
    background: {
      default: '#1F1A1C',
      paper: '#2B2427',
    },
    action: {
      selected: 'rgba(255, 164, 185, 0.32)',
      hover: 'rgba(255, 164, 185, 0.16)',
    },
    secondary: {
      main: '#FFA4B9',
      contrastText: '#1F1A1C',
    },
  },
};
