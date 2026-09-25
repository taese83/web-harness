export const routes = ['#/login', '#/seats']
export const current = () => (routes.includes(location.hash) ? location.hash : '#/login')
