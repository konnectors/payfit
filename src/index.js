// Force sentry DSN into environment variables
// In the future, will be set by the stack
process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://bb9b62dfb62d4492959a88240d402b21:cac5cbbc6b474095a4754ad2a5f1bf72@sentry.cozycloud.cc/80'

const {
  BaseKonnector,
  log,
  saveFiles,
  requestFactory,
  errors
} = require('cozy-konnector-libs')

const request = requestFactory({
  // debug: true,
  json: true,
  jar: true
})

const formatDate = require('date-fns/format')

module.exports = new BaseKonnector(start)

async function start(fields) {
  const tokens = await getTokens(fields)
  const payrolls = await fetchPayrolls(tokens)
  const documents = convertPayrollsToCozy(tokens, payrolls)
  return saveFiles(documents, fields)
}

function getTokens({ login, password }) {
  log('info', 'Login...')
  return request({
    uri: 'https://api.payfit.com/auth/signin',
    method: 'POST',
    body: {
      email: login,
      password: password,
      username: login,
      language: 'fr'
    }
  })
    .then(async body => {
      const employee = body.accounts.find(doc => doc.type === 'e')
      let id = employee.id
      let tokens = id.split('/')
      let companyId = tokens[0]
      let employeeId = tokens[1]

      // this is a server side-effect needed for the token to be valid
      await request('https://api.payfit.com/auth/updateCurrentAccount', {
        qs: { companyId, employeeId }
      })

      return { idToken: body.idToken, employeeId }
    })
    .catch(err => {
      if (
        err.statusCode === 401 &&
        err.error &&
        err.error.error === 'invalid_password'
      ) {
        throw new Error(errors.LOGIN_FAILED)
      } else {
        throw err
      }
    })
}

function fetchPayrolls(tokens) {
  const { idToken, employeeId } = tokens
  log('info', 'Fetching payrolls...')
  return request({
    method: 'POST',
    uri: 'https://api.payfit.com/hr/employees/payrolls',
    headers: {
      Authorization: idToken,
      'x-payfit-id': employeeId
    }
  })
}

function convertPayrollsToCozy(idToken, payrolls) {
  log('info', 'Converting payrolls to cozy...')
  return payrolls.map(({ url, absoluteMonth }) => {
    const date = getDateFromAbsoluteMonth(absoluteMonth)
    const filename = `${formatDate(date, 'YYYY_MM')}.pdf`
    return {
      fileurl: url,
      filename,
      requestOptions: {
        headers: {
          Authorization: idToken
        }
      }
    }
  })
}

// extracted from Payfit front code
function getDateFromAbsoluteMonth(absoluteMonth) {
  return new Date(2015, absoluteMonth - 1)
}
