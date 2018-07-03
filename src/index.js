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

let idToken = ''

function start(fields) {
  return logIn(fields)
    .then(fetchPayrolls)
    .then(convertPayrollsToCozy)
    .then(documents => saveFiles(documents, fields))
}

function logIn(fields) {
  log('info', 'Login...')
  return request({
    uri: 'https://api.payfit.com/auth/signin',
    method: 'POST',
    body: {
      email: fields.login,
      password: fields.password,
      username: fields.login,
      language: 'fr'
    }
  })
    .then(body => {
      const employee = body.accounts.find(doc => doc.type === 'e')
      let id = employee.id
      let tokens = id.split('/')
      let companyId = tokens[0]
      let employeeId = tokens[1]
      idToken = body.idToken

      return request.post('https://api.payfit.com/auth/updateCurrentCompany', {
        body: {
          application: 'hr-apps/user',
          companyId,
          customApp: false,
          employeeId,
          holdingId: null,
          idToken
        }
      })
    })
    .catch(err => {
      if (
        err.statusCode === 401 &&
        err.error &&
        err.error.error === 'Wrong email or password'
      ) {
        throw new Error(errors.LOGIN_FAILED)
      }
    })
}

function fetchPayrolls() {
  log('info', 'Fetching payrolls...')
  return request({
    method: 'POST',
    uri: 'https://api.payfit.com/hr/employees/payrolls',
    headers: {
      Authorization: idToken
    }
  })
}

function convertPayrollsToCozy(payrolls) {
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
