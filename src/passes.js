/*
 * Optimalization passes made on the grammar AST before compilation. Each pass
 * is a function that is passed the AST and returns a new AST. The AST can be
 * modified in-place by the pass. The order in which the passes are run is
 * specified in |PEG.compiler.compile| and should be the same as the order of
 * definitions here.
 */
PEG.compiler.passes = {
  /*
   * Removes proxy rules -- that is, rules that only delegate to other rule.
   */
  proxyRules: function(ast) {
    function isProxyRule(node) {
      return node.type === "rule" && node.expression.type === "rule_ref";
    }

    function replaceRuleRefs(ast, from, to) {
      function nop() {}

      function replaceInExpression(node, from, to) {
        replace(node.expression, from, to);
      }

      function replaceInSubnodes(propertyName) {
        return function(node, from, to) {
          node[propertyName].forEach(function(subnode) {
            replace(subnode, from, to);
          });
        };
      }

      var replace = buildNodeVisitor({
        grammar:
          function(node, from, to) {
            for (var name in node.rules) {
              replace(node.rules[name], from, to);
            }
          },

        rule:         replaceInExpression,
        choice:       replaceInSubnodes("alternatives"),
        sequence:     replaceInSubnodes("elements"),
        labeled:      replaceInExpression,
        simple_and:   replaceInExpression,
        simple_not:   replaceInExpression,
        semantic_and: nop,
        semantic_not: nop,
        optional:     replaceInExpression,
        zero_or_more: replaceInExpression,
        one_or_more:  replaceInExpression,
        action:       replaceInExpression,

        rule_ref:
          function(node, from, to) {
            if (node.name === from) {
              node.name = to;
            }
          },

        literal:      nop,
        any:          nop,
        "class":      nop
      });

      replace(ast, from, to);
    }

    for (var name in ast.rules) {
      if (isProxyRule(ast.rules[name])) {
        replaceRuleRefs(ast, ast.rules[name].name, ast.rules[name].expression.name);
        if (name === ast.startRule) {
          ast.startRule = ast.rules[name].expression.name;
        }
        delete ast.rules[name];
      }
    }

    return ast;
  },

  /*
   * Adds |resultStackDepth| and |posStackDepth| properties to each AST node.
   * These properties specify how many positions on the result or position stack
   * code generated by the emitter for the node will use. This information is
   * used to declare varibles holding the stack data in the generated code.
   */
  stackDepths: function(ast) {
    function computeZeroes(node) {
      node.resultStackDepth = 0;
      node.posStackDepth = 0;
    }

    function computeFromExpression(resultStackDelta, posStackDelta) {
      return function(node) {
        compute(node.expression);
        node.resultStackDepth = node.expression.resultStackDepth + resultStackDelta;
        node.posStackDepth    = node.expression.posStackDepth    + posStackDelta;
      };
    }

    var compute = buildNodeVisitor({
      grammar:
        function(node) {
          for (var name in node.rules) {
            compute(node.rules[name]);
          }
        },

      rule:         computeFromExpression(1, 1),

      choice:
        function(node) {
          node.alternatives.forEach(compute);
          node.resultStackDepth = Math.max.apply(
            null,
            node.alternatives.map(function(e) { return e.resultStackDepth; })
          );
          node.posStackDepth = Math.max.apply(
            null,
            node.alternatives.map(function(e) { return e.posStackDepth; })
          );
        },

      sequence:
        function(node) {
          node.elements.forEach(compute);
          node.resultStackDepth = 1 + Math.max.apply(
            null,
            node.elements.map(function(e, i) { return i + e.resultStackDepth; })
          );
          node.posStackDepth = 1 + Math.max.apply(
            null,
            node.elements.map(function(e) { return e.posStackDepth; })
          );
        },

      labeled:      computeFromExpression(0, 0),
      simple_and:   computeFromExpression(0, 1),
      simple_not:   computeFromExpression(0, 1),
      semantic_and: computeZeroes,
      semantic_not: computeZeroes,
      optional:     computeFromExpression(0, 0),
      zero_or_more: computeFromExpression(1, 0),
      one_or_more:  computeFromExpression(1, 0),
      action:       computeFromExpression(0, 1),
      rule_ref:     computeZeroes,
      literal:      computeZeroes,
      any:          computeZeroes,
      "class":      computeZeroes
    });

    compute(ast);

    return ast;
  }
};
