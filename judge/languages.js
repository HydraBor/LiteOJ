function cppLanguage(name, standard) {
  return {
    name,
    source: 'main.cpp',
    executable: 'main',
    compile: (workdir, options = {}) => ({
      command: 'g++',
      args: ['main.cpp', options.optimize === false ? '-O0' : '-O2', `-std=${standard}`, '-DONLINE_JUDGE', '-o', 'main'],
      timeoutMs: 10000,
    }),
    run: () => ({ command: './main', args: [] }),
  };
}

const languages = {
  cpp11: cppLanguage('C++11', 'c++11'),
  cpp14: cppLanguage('C++14', 'c++14'),
  cpp17: cppLanguage('C++17', 'c++17'),
  c: {
    name: 'C11',
    source: 'main.c',
    executable: 'main',
    compile: (workdir, options = {}) => ({
      command: 'gcc',
      args: ['main.c', options.optimize === false ? '-O0' : '-O2', '-std=c11', '-DONLINE_JUDGE', '-o', 'main'],
      timeoutMs: 10000,
    }),
    run: () => ({ command: './main', args: [] }),
  },
  python: {
    name: 'Python 3',
    source: 'main.py',
    executable: null,
    compile: null,
    run: () => ({ command: 'python3', args: ['main.py'] }),
  },
};

module.exports = languages;
